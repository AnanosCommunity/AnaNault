import { Component, OnInit } from '@angular/core';
import BigNumber from 'bignumber.js';
import {AddressBookService} from '../../services/address-book.service';
import {BehaviorSubject} from 'rxjs';
import {WalletService} from '../../services/wallet.service';
import {NotificationService} from '../../services/notification.service';
import {ApiService} from '../../services/api.service';
import {UtilService} from '../../services/util.service';
import {WorkPoolService} from '../../services/work-pool.service';
import {AppSettingsService} from '../../services/app-settings.service';
import {ActivatedRoute} from '@angular/router';
import {PriceService} from '../../services/price.service';
import {NanoBlockService} from '../../services/nano-block.service';
import { QrModalService } from '../../services/qr-modal.service';
import { environment } from 'environments/environment';
import { TranslocoService } from '@ngneat/transloco';

const nacl = window['nacl'];

@Component({
  selector: 'app-send',
  templateUrl: './send.component.html',
  styleUrls: ['./send.component.css']
})
export class SendComponent implements OnInit {
  nano = 1000000000000000000000000;

  activePanel = 'send';
  sendDestinationType = 'external-address';

  accounts = this.walletService.wallet.accounts;
  addressBookResults$ = new BehaviorSubject([]);
  showAddressBook = false;
  addressBookMatch = '';

  amounts = [
    { name: 'NANO', shortName: 'NANO', value: 'mnano' },
    { name: 'knano', shortName: 'knano', value: 'knano' },
    { name: 'nano', shortName: 'nano', value: 'nano' },
  ];
  selectedAmount = this.amounts[0];

  amount = null;
  amountExtraRaw = new BigNumber(0);
  amountFiat: number|null = null;
  rawAmount: BigNumber = new BigNumber(0);
  fromAccount: any = {};
  fromAccountID: any = '';
  fromAddressBook = '';
  toAccount: any = false;
  toAccountID = '';
  toOwnAccountID: any = '';
  toAddressBook = '';
  toAccountStatus = null;
  amountStatus = null;
  preparingTransaction = false;
  confirmingTransaction = false;
  selAccountInit = false;

  constructor(
    private router: ActivatedRoute,
    private walletService: WalletService,
    private addressBookService: AddressBookService,
    private notificationService: NotificationService,
    private nodeApi: ApiService,
    private nanoBlock: NanoBlockService,
    public price: PriceService,
    private workPool: WorkPoolService,
    public settings: AppSettingsService,
    private util: UtilService,
    private qrModalService: QrModalService,
    private translocoService: TranslocoService) { }

  async ngOnInit() {
    const params = this.router.snapshot.queryParams;

    this.updateQueries(params);

    this.addressBookService.loadAddressBook();

    // Set default From account
    this.fromAccountID = this.accounts.length ? this.accounts[0].id : '';

    // Update selected account if changed in the sidebar
    this.walletService.wallet.selectedAccount$.subscribe(async acc => {
      if (this.activePanel !== 'send') {
        // Transaction details already finalized
        return;
      }

      if (this.selAccountInit) {
        if (acc) {
          this.fromAccountID = acc.id;
        } else {
          this.findFirstAccount();
        }
      }
      this.selAccountInit = true;
    });

    // Update the account if query params changes. For example donation button while active on this page
    this.router.queryParams.subscribe(queries => {
      this.updateQueries(queries);
    });

    // Set the account selected in the sidebar as default
    if (this.walletService.wallet.selectedAccount !== null) {
      this.fromAccountID = this.walletService.wallet.selectedAccount.id;
    } else {
      // If "total balance" is selected in the sidebar, use the first account in the wallet that has a balance
      this.findFirstAccount();
    }
  }

  updateQueries(params) {
    if ( params && params.amount && !isNaN(params.amount) ) {
      const amountAsRaw =
        new BigNumber(
          this.util.nano.mnanoToRaw(
            new BigNumber(params.amount)
          )
        );

      this.amountExtraRaw = amountAsRaw.mod(this.nano).floor();

      this.amount =
        this.util.nano.rawToMnano(
          amountAsRaw.minus(this.amountExtraRaw)
        ).toNumber();

      this.syncFiatPrice();
    }

    if (params && params.to) {
      this.toAccountID = params.to;
      this.validateDestination();
      this.sendDestinationType = 'external-address';
    }
  }

  async findFirstAccount() {
    // Load balances before we try to find the right account
    if (this.walletService.wallet.balance.isZero()) {
      await this.walletService.reloadBalances();
    }

    // Look for the first account that has a balance
    const accountIDWithBalance = this.accounts.reduce((previous, current) => {
      if (previous) return previous;
      if (current.balance.gt(0)) return current.id;
      return null;
    }, null);

    if (accountIDWithBalance) {
      this.fromAccountID = accountIDWithBalance;
    }
  }

  // An update to the Nano amount, sync the fiat value
  syncFiatPrice() {
    if (!this.validateAmount()) return;
    const rawAmount = this.getAmountBaseValue(this.amount || 0).plus(this.amountExtraRaw);
    if (rawAmount.lte(0)) {
      this.amountFiat = 0;
      return;
    }

    // This is getting hacky, but if their currency is bitcoin, use 6 decimals, if it is not, use 2
    const precision = this.settings.settings.displayCurrency === 'BTC' ? 1000000 : 100;

    // Determine fiat value of the amount
    const fiatAmount = this.util.nano.rawToMnano(rawAmount).times(this.price.price.lastPrice)
      .times(precision).floor().div(precision).toNumber();

    this.amountFiat = fiatAmount;
  }

  // An update to the fiat amount, sync the nano value based on currently selected denomination
  syncNanoPrice() {
    if (!this.amountFiat) {
      this.amount = '';
      return;
    }
    if (!this.util.string.isNumeric(this.amountFiat)) return;
    const rawAmount = this.util.nano.mnanoToRaw(new BigNumber(this.amountFiat).div(this.price.price.lastPrice));
    const nanoVal = this.util.nano.rawToNano(rawAmount).floor();
    const nanoAmount = this.getAmountValueFromBase(this.util.nano.nanoToRaw(nanoVal));

    this.amount = nanoAmount.toNumber();
  }

  searchAddressBook() {
    this.showAddressBook = true;
    const search = this.toAccountID || '';
    const addressBook = this.addressBookService.addressBook;

    const matches = addressBook
      .filter(a => a.name.toLowerCase().indexOf(search.toLowerCase()) !== -1)
      .slice(0, 5);

    this.addressBookResults$.next(matches);
  }

  selectBookEntry(account) {
    this.showAddressBook = false;
    this.toAccountID = account;
    this.searchAddressBook();
    this.validateDestination();
  }

  setSendDestinationType(newType: string) {
    this.sendDestinationType = newType;
  }

  async validateDestination() {
    // The timeout is used to solve a bug where the results get hidden too fast and the click is never registered
    setTimeout(() => this.showAddressBook = false, 400);

    // Remove spaces from the account id
    this.toAccountID = this.toAccountID.replace(/ /g, '');

    this.addressBookMatch = (
        this.addressBookService.getAccountName(this.toAccountID)
      || this.getAccountLabel(this.toAccountID, null)
    );

    if (!this.addressBookMatch && this.toAccountID === environment.donationAddress) {
      this.addressBookMatch = 'Nault Donations';
    }

    // const accountInfo = await this.walletService.walletApi.accountInfo(this.toAccountID);
    this.toAccountStatus = null;
    if (this.util.account.isValidAccount(this.toAccountID)) {
      const accountInfo = await this.nodeApi.accountInfo(this.toAccountID);
      if (accountInfo.error) {
        if (accountInfo.error === 'Account not found') {
          this.toAccountStatus = 1;
        }
      }
      if (accountInfo && accountInfo.frontier) {
        this.toAccountStatus = 2;
      }
    } else {
      this.toAccountStatus = 0;
    }
  }

  getAccountLabel(accountID, defaultLabel) {
    const walletAccount = this.walletService.wallet.accounts.find(a => a.id === accountID);

    if (walletAccount == null) {
      return defaultLabel;
    }

    return (this.translocoService.translate('general.account') + '#' + walletAccount.index);
  }

  validateAmount() {
    if (this.util.account.isValidNanoAmount(this.amount)) {
      this.amountStatus = 1;
      return true;
    } else {
      this.amountStatus = 0;
      return false;
    }
  }

  getDestinationID() {
    if (this.sendDestinationType === 'external-address') {
      return this.toAccountID;
    }

    // 'own-address'
    const walletAccount = this.walletService.wallet.accounts.find(a => a.id === this.toOwnAccountID);

    if (!walletAccount) {
      // Unable to find receiving account in wallet
      return '';
    }

    if (this.toOwnAccountID === this.fromAccountID) {
      // Sending to the same address is only allowed via 'external-address'
      return '';
    }

    return this.toOwnAccountID;
  }

  async sendTransaction() {
    const destinationID = this.getDestinationID();
    const isValid = this.util.account.isValidAccount(destinationID);
    if (!isValid) {
      return this.notificationService.sendWarning(`To account address is not valid`);
    }
    if (!this.fromAccountID || !destinationID) {
      return this.notificationService.sendWarning(`From and to account are required`);
    }
    if (!this.validateAmount()) {
      return this.notificationService.sendWarning(`Invalid NANO Amount`);
    }

    this.preparingTransaction = true;

    const from = await this.nodeApi.accountInfo(this.fromAccountID);
    const to = await this.nodeApi.accountInfo(destinationID);

    this.preparingTransaction = false;

    if (!from) {
      return this.notificationService.sendError(`From account not found`);
    }

    from.balanceBN = new BigNumber(from.balance || 0);
    to.balanceBN = new BigNumber(to.balance || 0);

    this.fromAccount = from;
    this.toAccount = to;

    const rawAmount = this.getAmountBaseValue(this.amount || 0);
    this.rawAmount = rawAmount.plus(this.amountExtraRaw);

    const nanoAmount = this.rawAmount.div(this.nano);

    if (this.amount < 0 || rawAmount.lessThan(0)) {
      return this.notificationService.sendWarning(`Amount is invalid`);
    }
    if (from.balanceBN.minus(rawAmount).lessThan(0)) {
      return this.notificationService.sendError(`From account does not have enough NANO`);
    }

    // Determine a proper raw amount to show in the UI, if a decimal was entered
    this.amountExtraRaw = this.rawAmount.mod(this.nano);

    // Determine fiat value of the amount
    this.amountFiat = this.util.nano.rawToMnano(rawAmount).times(this.price.price.lastPrice).toNumber();

    this.fromAddressBook = (
        this.addressBookService.getAccountName(this.fromAccountID)
      || this.getAccountLabel(this.fromAccountID, 'Account')
    );

    this.toAddressBook = (
        this.addressBookService.getAccountName(destinationID)
      || this.getAccountLabel(destinationID, null)
    );

    // Start precomputing the work...
    this.workPool.addWorkToCache(this.fromAccount.frontier, 1);

    this.activePanel = 'confirm';
  }

  async confirmTransaction() {
    const walletAccount = this.walletService.wallet.accounts.find(a => a.id === this.fromAccountID);
    if (!walletAccount) {
      throw new Error(`Unable to find sending account in wallet`);
    }
    if (this.walletService.walletIsLocked()) {
      return this.notificationService.sendWarning(`Wallet must be unlocked`);
    }

    this.confirmingTransaction = true;

    try {
      const destinationID = this.getDestinationID();

      const newHash = await this.nanoBlock.generateSend(walletAccount, destinationID,
        this.rawAmount, this.walletService.isLedgerWallet());

      if (newHash) {
        this.notificationService.removeNotification('success-send');
        this.notificationService.sendSuccess(`Successfully sent ${this.amount} ${this.selectedAmount.shortName}!`, { identifier: 'success-send' });
        this.activePanel = 'send';
        this.amount = null;
        this.amountFiat = null;
        this.resetRaw();
        this.toAccountID = '';
        this.toOwnAccountID = '';
        this.toAccountStatus = null;
        this.fromAddressBook = '';
        this.toAddressBook = '';
        this.addressBookMatch = '';
      } else {
        if (!this.walletService.isLedgerWallet()) {
          this.notificationService.sendError(`There was an error sending your transaction, please try again.`);
        }
      }
    } catch (err) {
      this.notificationService.sendError(`There was an error sending your transaction: ${err.message}`);
    }


    this.confirmingTransaction = false;

    await this.walletService.reloadBalances();
  }

  setMaxAmount() {
    const walletAccount = this.walletService.wallet.accounts.find(a => a.id === this.fromAccountID);
    if (!walletAccount) {
      return;
    }

    this.amountExtraRaw = walletAccount.balanceRaw;

    const nanoVal = this.util.nano.rawToNano(walletAccount.balance).floor();
    const maxAmount = this.getAmountValueFromBase(this.util.nano.nanoToRaw(nanoVal));
    this.amount = maxAmount.toNumber();
    this.syncFiatPrice();
  }

  resetRaw() {
    this.amountExtraRaw = new BigNumber(0);
  }

  getAmountBaseValue(value) {

    switch (this.selectedAmount.value) {
      default:
      case 'nano': return this.util.nano.nanoToRaw(value);
      case 'knano': return this.util.nano.knanoToRaw(value);
      case 'mnano': return this.util.nano.mnanoToRaw(value);
    }
  }

  getAmountValueFromBase(value) {
    switch (this.selectedAmount.value) {
      default:
      case 'nano': return this.util.nano.rawToNano(value);
      case 'knano': return this.util.nano.rawToKnano(value);
      case 'mnano': return this.util.nano.rawToMnano(value);
    }
  }

  // open qr reader modal
  openQR(reference, type) {
    const qrResult = this.qrModalService.openQR(reference, type);
    qrResult.then((data) => {
      switch (data.reference) {
        case 'account1':
          this.toAccountID = data.content;
          this.validateDestination();
          break;
      }
    }, () => {}
    );
  }

  copied() {
    this.notificationService.removeNotification('success-copied');
    this.notificationService.sendSuccess(`Successfully copied to clipboard!`, { identifier: 'success-copied' });
  }

}
