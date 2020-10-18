import { Injectable } from '@angular/core';
import Nano from 'hw-app-nano';
import TransportU2F from '@ledgerhq/hw-transport-u2f';
import TransportUSB from '@ledgerhq/hw-transport-webusb';
import TransportHID from '@ledgerhq/hw-transport-webhid';
import TransportBLE from '@ledgerhq/hw-transport-web-ble';
import Transport from '@ledgerhq/hw-transport';
import {Subject} from 'rxjs';
import {ApiService} from './api.service';
import {NotificationService} from './notification.service';
import { environment } from '../../environments/environment';
import {DesktopService} from './desktop.service';

export const STATUS_CODES = {
  SECURITY_STATUS_NOT_SATISFIED: 0x6982,
  CONDITIONS_OF_USE_NOT_SATISFIED: 0x6985,
  INVALID_SIGNATURE: 0x6a81,
  CACHE_MISS: 0x6a82
};

export const LedgerStatus = {
  NOT_CONNECTED: 'not-connected',
  LOCKED: 'locked',
  READY: 'ready',
};


export interface LedgerData {
  status: string;
  nano: any|null;
  transport: Transport|null;
}

const zeroBlock = '0000000000000000000000000000000000000000000000000000000000000000';

@Injectable()
export class LedgerService {
  walletPrefix = `44'/165'/`;

  waitTimeout = 300000;
  normalTimeout = 5000;
  pollInterval = 15000;

  pollingLedger = false;

  ledger: LedgerData = {
    status: LedgerStatus.NOT_CONNECTED,
    nano: null,
    transport: null,
  };

  // isDesktop = true;
  isDesktop = environment.desktop;
  queryingDesktopLedger = false;

  supportsU2F = false;
  supportsWebHID = false;
  supportsWebUSB = false;
  supportsBluetooth = this.isDesktop;

  transportMode: 'U2F' | 'USB' | 'HID' | 'Bluetooth' = 'U2F';
  DynamicTransport = TransportU2F;

  ledgerStatus$: Subject<any> = new Subject();
  desktopMessage$ = new Subject();

  constructor(private api: ApiService,
              private desktop: DesktopService,
              private notifications: NotificationService) {
    if (this.isDesktop) {
      this.configureDesktop();
    } else {
      this.checkBrowserSupport();
    }
  }

  // Scraps binding to any existing transport/nano object
  resetLedger() {
    this.ledger.transport = null;
    this.ledger.nano = null;
  }

  /**
   * Prepare the main listener for events from the desktop client.
   * Dispatches new messages via the main Observables
   */
  configureDesktop() {
    this.desktop.connect();
    this.desktop.on('ledger', (event, message) => {
      if (!message || !message.event) return;
      switch (message.event) {
        case 'ledger-status':
          this.ledger.status = message.data.status;
          this.ledgerStatus$.next({ status: message.data.status, statusText: message.data.statusText });
          break;

        case 'account-details':
        case 'cache-block':
        case 'sign-block':
          this.desktopMessage$.next(message);
          break;
      }
    });
  }

  /**
   * Check which transport protocols are supported by the browser
   */
  checkBrowserSupport() {
    TransportU2F.isSupported().then(supported => this.supportsU2F = supported);
    TransportHID.isSupported().then(supported => this.supportsWebHID = supported);
    TransportUSB.isSupported().then(supported => this.supportsWebUSB = supported);
    TransportBLE.isSupported().then(supported => this.supportsBluetooth = supported);
  }

  /**
   * Detect the optimal USB transport protocol for the current browser and OS
   */
  detectUsbTransport() {
    if (this.supportsWebUSB) {
      // Prefer WebUSB
      this.transportMode = 'USB';
      this.DynamicTransport = TransportUSB;
    } else if (this.supportsWebHID) {
      // Fallback to WebHID
      this.transportMode = 'HID';
      this.DynamicTransport = TransportHID;
    } else {
      // Legacy browsers
      this.transportMode = 'U2F';
      this.DynamicTransport = TransportU2F;
    }
  }

  /**
   * Enable or disable bluetooth communication, if supported
   * @param enabled   The bluetooth enabled state
   */
  enableBluetoothMode(enabled: boolean) {
    if (this.supportsBluetooth && enabled) {
      this.transportMode = 'Bluetooth';
      this.DynamicTransport = TransportBLE;
    } else {
        this.detectUsbTransport();
    }
  }

  /**
   * Get the next response coming from the desktop client for a specific event/filter
   * @param eventType
   * @param {any} filterFn
   * @returns {Promise<any>}
   */
  async getDesktopResponse(eventType, filterFn?) {
    return new Promise((resolve, reject) => {
      const sub = this.desktopMessage$
        .subscribe((response: any) => {
          // Listen to all desktop messages until one passes our filters
          if (response.event !== eventType) {
            return; // Not the event we want.
          }

          if (filterFn) {
            const shouldSkip = filterFn(response.data); // This function should return boolean
            if (!shouldSkip) return; // This is not the message the subscriber wants
          }

          sub.unsubscribe(); // This is a message we want, safe to unsubscribe to further messages now.

          if (response.data && response.data.error === true) {
            return reject(new Error(response.data.errorMessage)); // Request failed!
          }

          resolve(response.data);
        }, err => {
          console.log(`Desktop message got error!`, err);
          reject(err);
        });
    });

  }



  async getLedgerAccountDesktop(accountIndex, showOnScreen) {
    if (this.queryingDesktopLedger) {
      throw new Error(`Already querying desktop device, please wait`);
    }
    this.queryingDesktopLedger = true;

    this.desktop.send('ledger', { event: 'account-details', data: { accountIndex, showOnScreen } });

    try {
      const details = await this.getDesktopResponse('account-details', a => a.accountIndex === accountIndex);
      this.queryingDesktopLedger = false;

      return details;
    } catch (err) {
      this.queryingDesktopLedger = false;
      throw err;
    }
  }

  async updateCacheDesktop(accountIndex, cacheData, signature) {
    if (this.queryingDesktopLedger) {
      throw new Error(`Already querying desktop device, please wait`);
    }
    this.queryingDesktopLedger = true;

    this.desktop.send('ledger', { event: 'cache-block', data: { accountIndex, cacheData, signature } });

    try {
      const details = await this.getDesktopResponse('cache-block', a => a.accountIndex === accountIndex);
      this.queryingDesktopLedger = false;

      return details;
    } catch (err) {
      this.queryingDesktopLedger = false;
      throw new Error(`Error caching block: ${err.message}`);
    }
  }

  async signBlockDesktop(accountIndex, blockData) {
    if (this.queryingDesktopLedger) {
      throw new Error(`Already querying desktop device, please wait`);
    }
    this.queryingDesktopLedger = true;

    this.desktop.send('ledger', { event: 'sign-block', data: { accountIndex, blockData } });

    try {
      const details = await this.getDesktopResponse('sign-block', a => a.accountIndex === accountIndex);
      this.queryingDesktopLedger = false;

      return details;
    } catch (err) {
      this.queryingDesktopLedger = false;
      throw new Error(`Error signing block: ${err.message}`);
    }
  }

  async loadTransport() {
    return new Promise((resolve, reject) => {
      this.DynamicTransport.create().then(trans => {

        this.ledger.transport = trans;
        this.ledger.transport.setExchangeTimeout(this.waitTimeout); // 5 minutes
        this.ledger.nano = new Nano(this.ledger.transport);

        resolve(this.ledger.transport);
      }).catch(reject);
    });
  }


  /**
   * Main ledger loading function.  Can be called multiple times to attempt a reconnect.
   * @param {boolean} hideNotifications
   * @returns {Promise<any>}
   */
  async loadLedger(hideNotifications = false) {
    return new Promise(async (resolve, reject) => {

      // Desktop is handled completely differently.  Send a message for status instead of setting anything up
      if (this.isDesktop) {
        if (!this.desktop.send('ledger', { event: 'get-ledger-status', data: { bluetooth: this.transportMode === 'Bluetooth' } })) {
          reject(new Error(`Electron\'s IPC was not loaded`));
        }

        // Any response will be handled by the configureDesktop() function, which pipes responses into this observable
        const sub = this.ledgerStatus$.subscribe(newStatus => {
          if (newStatus.status === LedgerStatus.READY) {
            resolve(true);
          } else {
            reject(new Error(newStatus.statusText || `Unable to load desktop Ledger device`));
          }
          sub.unsubscribe();
        }, reject);
        return;
      }

      // Use modern transport connection mode if supported by the browser
      if (!this.ledger.transport) {

        // If in USB mode, detect best transport option
        if (this.transportMode !== 'Bluetooth') {
          this.detectUsbTransport();
        }

        try {
          await this.loadTransport();
        } catch (err) {
          console.log(`Error loading ${this.transportMode} transport `, err);
          this.ledger.status = LedgerStatus.NOT_CONNECTED;
          this.ledgerStatus$.next({ status: this.ledger.status, statusText: `Unable to load Ledger transport: ${err.message || err}` });
          this.resetLedger();
          resolve(false);
        }
      }

      // Legacy mode

      // Note:
      // Everything else below is for loading the Ledger via the browser using Chrome U2F Bridge (Requires https)

      // Load the transport object
      // if (!this.ledger.transport) {
      //   try {
      //     this.ledger.transport = await this.DynamicTransport.open(null);
      //     this.ledger.transport.setExchangeTimeout(this.waitTimeout); // 5 minutes
      //   } catch (err) {
      //     console.log(`Transport error: `, err);
      //     if (err.statusText === 'UNKNOWN_ERROR') {
      //       this.resetLedger();
      //     }
      //     this.ledgerStatus$.next({ status: this.ledger.status, statusText: `Unable to load USB transport` });
      //     return resolve(false);
      //   }
      // }

      // // Load nano object
      // if (!this.ledger.nano) {
      //   try {
      //     this.ledger.nano = new Nano(this.ledger.transport);
      //   } catch (err) {
      //     console.log(`Nano error: `, err);
      //     if (err.statusText === 'UNKNOWN_ERROR') {
      //       this.resetLedger();
      //     }
      //     this.ledgerStatus$.next({ status: this.ledger.status, statusText: `Error loading Nano USB transport` });
      //     return resolve(false);
      //   }
      // }


      if (!this.ledger.transport || !this.ledger.nano) {
        return resolve(false);
      }

      console.log(this.ledger.status);
      if (this.ledger.status === LedgerStatus.READY) {
        return resolve(true); // Already ready?
      }
      let resolved = false;

      // Set up a timeout when things are not ready
      setTimeout(() => {
        if (resolved) return;
        console.log(`Timeout expired, sending not connected`);
        this.ledger.status = LedgerStatus.NOT_CONNECTED;
        this.ledgerStatus$.next({ status: this.ledger.status, statusText: `Unable to detect Nano Ledger application (Timeout)` });
        if (!hideNotifications) {
          this.notifications.sendWarning(`Unable to connect to the Ledger device.  Make sure it is unlocked and the Nano application is open`);
        }
        resolved = true;
        return resolve(false);
      }, 2500);

      // Try to load the app config
      try {
        const ledgerConfig = await this.ledger.nano.getAppConfiguration();
        resolved = true;

        if (!ledgerConfig) return resolve(false);
        if (ledgerConfig && ledgerConfig.version) {
          this.ledger.status = LedgerStatus.LOCKED;
          this.ledgerStatus$.next({ status: this.ledger.status, statusText: `Nano app detected, but ledger is locked` });
        }
      } catch (err) {
        console.log(`App config error: `, err);
        if (err.statusText === 'HALTED') {
          this.resetLedger();
        }
        if (!hideNotifications && !resolved) {
          this.notifications.sendWarning(`Unable to connect to the Ledger device.  Make sure your ledger is unlocked.  Restart the Nano App on your ledger if the error persists`);
        }
        resolved = true;
        return resolve(false);
      }

      // Attempt to load account 0 - which confirms the app is unlocked and ready
      try {
        const accountDetails = await this.getLedgerAccount(0);
        this.ledger.status = LedgerStatus.READY;
        this.ledgerStatus$.next({ status: this.ledger.status, statusText: `Nano Ledger application connected` });

        if (!this.pollingLedger) {
          this.pollingLedger = true;
          this.pollLedgerStatus();
        }
      } catch (err) {
        console.log(`Error on account details: `, err);
        if (err.statusCode === STATUS_CODES.SECURITY_STATUS_NOT_SATISFIED) {
          if (!hideNotifications) {
            this.notifications.sendWarning(`Ledger device locked.  Unlock and open the Nano application`);
          }
        }
      }

      resolve(true);
    }).catch(err => {
      console.log(`error when loading ledger `, err);
      if (!hideNotifications) {
        this.notifications.sendWarning(`Error loading Ledger device: ${typeof err === 'string' ? err : err.message}`, { length: 6000 });
      }

      return null;
    });

  }

  async updateCache(accountIndex, blockHash) {
    if (this.ledger.status !== LedgerStatus.READY) {
      await this.loadLedger(); // Make sure ledger is ready
    }
    const blockResponse = await this.api.blocksInfo([blockHash]);
    const blockData = blockResponse.blocks[blockHash];
    if (!blockData) throw new Error(`Unable to load block data`);
    blockData.contents = JSON.parse(blockData.contents);

    const cacheData = {
      representative: blockData.contents.representative,
      balance: blockData.contents.balance,
      previousBlock: blockData.contents.previous === zeroBlock ? null : blockData.contents.previous,
      sourceBlock: blockData.contents.link,
    };

    if (this.isDesktop) {
      return await this.updateCacheDesktop(accountIndex, cacheData, blockData.contents.signature);
    } else {
      return await this.ledger.nano.cacheBlock(this.ledgerPath(accountIndex), cacheData, blockData.contents.signature);
    }
  }

  async updateCacheOffline(accountIndex, blockData) {
    if (this.ledger.status !== LedgerStatus.READY) {
      await this.loadLedger(); // Make sure ledger is ready
    }

    const cacheData = {
      representative: blockData.representative,
      balance: blockData.balance,
      previousBlock: blockData.previous === zeroBlock ? null : blockData.previous,
      sourceBlock: blockData.link,
    };

    if (this.isDesktop) {
      return await this.updateCacheDesktop(accountIndex, cacheData, blockData.signature);
    } else {
      return await this.ledger.nano.cacheBlock(this.ledgerPath(accountIndex), cacheData, blockData.signature);
    }
  }

  async signBlock(accountIndex: number, blockData: any) {
    if (this.ledger.status !== LedgerStatus.READY) {
      await this.loadLedger(); // Make sure ledger is ready
    }
    if (this.isDesktop) {
      return this.signBlockDesktop(accountIndex, blockData);
    } else {
      this.ledger.transport.setExchangeTimeout(this.waitTimeout);
      return await this.ledger.nano.signBlock(this.ledgerPath(accountIndex), blockData);
    }
  }

  ledgerPath(accountIndex: number) {
    return `${this.walletPrefix}${accountIndex}'`;
  }

  async getLedgerAccountWeb(accountIndex: number, showOnScreen = false) {
    this.ledger.transport.setExchangeTimeout(showOnScreen ? this.waitTimeout : this.normalTimeout);
    try {
      return await this.ledger.nano.getAddress(this.ledgerPath(accountIndex), showOnScreen);
    } catch (err) {
      throw err;
    }
  }

  async getLedgerAccount(accountIndex: number, showOnScreen = false) {
    if (this.isDesktop) {
      return await this.getLedgerAccountDesktop(accountIndex, showOnScreen);
    } else {
      return await this.getLedgerAccountWeb(accountIndex, showOnScreen);
    }
  }

  pollLedgerStatus() {
    if (!this.pollingLedger) return;
    setTimeout(async () => {
      await this.checkLedgerStatus();
      this.pollLedgerStatus();
    }, this.pollInterval);
  }

  async checkLedgerStatus() {
    if (this.ledger.status !== LedgerStatus.READY) {
      return;
    }

    try {
      const accountDetails = await this.getLedgerAccount(0);
      this.ledger.status = LedgerStatus.READY;
    } catch (err) {
      // Ignore race condition error, which means an action is pending on the ledger (such as block confirmation)
      if (err.name !== 'TransportRaceCondition') {
        console.log('Check ledger status failed ', err);
        this.ledger.status = LedgerStatus.NOT_CONNECTED;
        this.pollingLedger = false;
      }
    }

    this.ledgerStatus$.next({ status: this.ledger.status, statusText: `` });
  }



}
