import {Component, OnDestroy, OnInit} from '@angular/core';
import {ActivatedRoute, ChildActivationEnd, Router, NavigationEnd} from '@angular/router';
import {AddressBookService} from '../../services/address-book.service';
import {ApiService} from '../../services/api.service';
import {NotificationService} from '../../services/notification.service';
import {WalletService} from '../../services/wallet.service';
import {NanoBlockService} from '../../services/nano-block.service';
import {AppSettingsService} from '../../services/app-settings.service';
import {PriceService} from '../../services/price.service';
import {UtilService} from '../../services/util.service';
import * as QRCode from 'qrcode';
import BigNumber from 'bignumber.js';
import {RepresentativeService} from '../../services/representative.service';
import {BehaviorSubject} from 'rxjs';
import * as nanocurrency from 'nanocurrency';
import {NinjaService} from '../../services/ninja.service';
import { QrModalService } from '../../services/qr-modal.service';

@Component({
  selector: 'app-account-details',
  templateUrl: './account-details.component.html',
  styleUrls: ['./account-details.component.css']
})
export class AccountDetailsComponent implements OnInit, OnDestroy {
  nano = 1000000000000000000000000;
  zeroHash = '0000000000000000000000000000000000000000000000000000000000000000';

  accountHistory: any[] = [];
  pendingBlocks = [];
  pageSize = 25;
  maxPageSize = 200;

  repLabel: any = '';
  addressBookEntry: any = null;
  account: any = {};
  accountID = '';

  walletAccount = null;

  showEditAddressBook = false;
  addressBookModel = '';
  showEditRepresentative = false;
  representativeModel = '';
  representativeResults$ = new BehaviorSubject([]);
  showRepresentatives = false;
  representativeListMatch = '';
  isNaN = isNaN;

  qrCodeImage = null;

  routerSub = null;
  priceSub = null;

  statsRefreshEnabled = true;

  // Remote signing
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
  amountRaw: BigNumber = new BigNumber(0);
  amountFiat: number|null = null;
  rawAmount: BigNumber = new BigNumber(0);
  fromAccount: any = {};
  toAccount: any = false;
  toAccountID = '';
  toAddressBook = '';
  toAccountStatus = null;
  amountStatus = null;
  repStatus = null;
  qrString = null;
  qrCodeImageBlock = null;
  qrCodeImageBlockReceive = null;
  blockHash = null;
  blockHashReceive = null;
  remoteVisible = false;
  blockTypes: string[] = ['Send Nano', 'Change Representative'];
  blockTypeSelected: string = this.blockTypes[0];
  representativeList = [];
  // End remote signing

  constructor(
    private router: ActivatedRoute,
    private route: Router,
    private addressBook: AddressBookService,
    private api: ApiService,
    private price: PriceService,
    private repService: RepresentativeService,
    private notifications: NotificationService,
    private wallet: WalletService,
    private util: UtilService,
    public settings: AppSettingsService,
    private nanoBlock: NanoBlockService,
    private qrModalService: QrModalService,
    private ninja: NinjaService) {
      // to detect when the account changes if the view is already active
      route.events.subscribe((val) => {
        if (val instanceof NavigationEnd) {
          this.clearRemoteVars(); // reset the modal content for remote signing
        }
      });
  }

  async ngOnInit() {
    const params = this.router.snapshot.queryParams;
    if ('sign' in params) {
      this.remoteVisible = params.sign === 1;
    }

    this.routerSub = this.route.events.subscribe(event => {
      if (event instanceof ChildActivationEnd) {
        this.loadAccountDetails(); // Reload the state when navigating to itself from the transactions page
      }
    });
    this.priceSub = this.price.lastPrice$.subscribe(event => {
      this.account.balanceFiat = this.util.nano.rawToMnano(this.account.balance || 0).times(this.price.price.lastPrice).toNumber();
      this.account.pendingFiat = this.util.nano.rawToMnano(this.account.pending || 0).times(this.price.price.lastPrice).toNumber();
    });

    await this.loadAccountDetails();
    this.addressBook.loadAddressBook();

    // populate representative list
    if (!this.settings.settings.serverAPI) return;
    const verifiedReps = await this.ninja.recommendedRandomized();

    for (const representative of verifiedReps) {
      const temprep = {
        id: representative.account,
        name: representative.alias
      };

      this.representativeList.push(temprep);
    }

    // add the localReps to the list
    const localReps = this.repService.getSortedRepresentatives();
    this.representativeList.push(...localReps);
  }

  clearRemoteVars() {
    this.selectedAmount = this.amounts[0];
    this.amount = null;
    this.amountRaw = new BigNumber(0);
    this.amountFiat = null;
    this.rawAmount = new BigNumber(0);
    this.fromAccount = {};
    this.toAccount = false;
    this.toAccountID = '';
    this.toAddressBook = '';
    this.toAccountStatus = null;
    this.repStatus = null;
    this.qrString = null;
    this.qrCodeImageBlock = null;
    this.qrCodeImageBlockReceive = null;
    this.blockHash = null;
    this.blockHashReceive = null;
    this.blockTypeSelected = this.blockTypes[0];
    this.representativeModel = '';
    this.representativeListMatch = '';
  }

  async loadAccountDetails(refresh= false) {
    if (refresh && !this.statsRefreshEnabled) return;
    this.statsRefreshEnabled = false;
    setTimeout(() => this.statsRefreshEnabled = true, 5000);

    this.pendingBlocks = [];
    this.accountID = this.router.snapshot.params.account;
    this.addressBookEntry = this.addressBook.getAccountName(this.accountID);
    this.addressBookModel = this.addressBookEntry || '';
    this.walletAccount = this.wallet.getWalletAccount(this.accountID);
    this.account = await this.api.accountInfo(this.accountID);

    if (!this.account) return;
    const knownRepresentative = this.repService.getRepresentative(this.account.representative);
    this.repLabel = knownRepresentative ? knownRepresentative.name : null;

    // If there is a pending balance, or the account is not opened yet, load pending transactions
    if ((!this.account.error && this.account.pending > 0) || this.account.error) {
      // Take minimum receive into account
      let pending;
      if (this.settings.settings.minimumReceive) {
        const minAmount = this.util.nano.mnanoToRaw(this.settings.settings.minimumReceive);
        pending = await this.api.pendingLimit(this.accountID, 50, minAmount.toString(10));
        this.account.pending = '0';
      } else {
        pending = await this.api.pending(this.accountID, 50);
      }

      if (pending && pending.blocks) {
        for (const block in pending.blocks) {
          if (!pending.blocks.hasOwnProperty(block)) continue;
          this.pendingBlocks.push({
            account: pending.blocks[block].source,
            amount: pending.blocks[block].amount,
            local_timestamp: pending.blocks[block].local_timestamp,
            addressBookName: this.addressBook.getAccountName(pending.blocks[block].source) || null,
            hash: block,
          });

          // Update the actual account pending amount with this above-threshold-value
          if (this.settings.settings.minimumReceive) {
            this.account.pending = new BigNumber(this.account.pending).plus(pending.blocks[block].amount).toString(10);
          }
        }
      }
    }

    // If the account doesnt exist, set the pending balance manually
    if (this.account.error) {
      const pendingRaw = this.pendingBlocks.reduce(
        (prev: BigNumber, current: any) => prev.plus(new BigNumber(current.amount)),
        new BigNumber(0)
      );
      this.account.pending = pendingRaw;
    }

    // Set fiat values?
    this.account.balanceRaw = new BigNumber(this.account.balance || 0).mod(this.nano);
    this.account.pendingRaw = new BigNumber(this.account.pending || 0).mod(this.nano);
    this.account.balanceFiat = this.util.nano.rawToMnano(this.account.balance || 0).times(this.price.price.lastPrice).toNumber();
    this.account.pendingFiat = this.util.nano.rawToMnano(this.account.pending || 0).times(this.price.price.lastPrice).toNumber();
    await this.getAccountHistory(this.accountID);


    const qrCode = await QRCode.toDataURL(`${this.accountID}`);
    this.qrCodeImage = qrCode;
  }

  ngOnDestroy() {
    if (this.routerSub) {
      this.routerSub.unsubscribe();
    }
    if (this.priceSub) {
      this.priceSub.unsubscribe();
    }
  }

  async getAccountHistory(account, resetPage = true) {
    if (resetPage) {
      this.pageSize = 25;
    }
    const history = await this.api.accountHistory(account, this.pageSize, true);
    const additionalBlocksInfo = [];

    if (history && history.history && Array.isArray(history.history)) {
      this.accountHistory = history.history.map(h => {
        if (h.type === 'state') {
          // For Open and receive blocks, we need to look up block info to get originating account
          if (h.subtype === 'open' || h.subtype === 'receive') {
            additionalBlocksInfo.push({ hash: h.hash, link: h.link });
          } else {
            h.link_as_account = this.util.account.getPublicAccountID(this.util.hex.toUint8(h.link));
            h.addressBookName = this.addressBook.getAccountName(h.link_as_account) || null;
          }
        } else {
          h.addressBookName = this.addressBook.getAccountName(h.account) || null;
        }
        return h;
      });

      // Remove change blocks now that we are using the raw output
      this.accountHistory = this.accountHistory.filter(h => h.type !== 'change' && h.subtype !== 'change');

      if (additionalBlocksInfo.length) {
        const blocksInfo = await this.api.blocksInfo(additionalBlocksInfo.map(b => b.link));
        for (const block in blocksInfo.blocks) {
          if (!blocksInfo.blocks.hasOwnProperty(block)) continue;

          const matchingBlock = additionalBlocksInfo.find(a => a.link === block);
          if (!matchingBlock) continue;
          const accountInHistory = this.accountHistory.find(h => h.hash === matchingBlock.hash);
          if (!accountInHistory) continue;

          const blockData = blocksInfo.blocks[block];

          accountInHistory.link_as_account = blockData.block_account;
          accountInHistory.addressBookName = this.addressBook.getAccountName(blockData.block_account) || null;
        }
      }

    } else {
      this.accountHistory = [];
    }
  }

  async loadMore() {
    if (this.pageSize <= this.maxPageSize) {
      this.pageSize += 25;
      await this.getAccountHistory(this.accountID, false);
    }
  }

  async saveRepresentative() {
    if (this.wallet.walletIsLocked()) return this.notifications.sendWarning(`Wallet must be unlocked`);
    if (!this.walletAccount) return;
    const repAccount = this.representativeModel;

    const valid = this.util.account.isValidAccount(repAccount);
    if (!valid) return this.notifications.sendWarning(`Account ID is not a valid account`);

    try {
      const changed = await this.nanoBlock.generateChange(this.walletAccount, repAccount, this.wallet.isLedgerWallet());
      if (!changed) {
        this.notifications.sendError(`Error changing representative, please try again`);
        return;
      }
    } catch (err) {
      this.notifications.sendError(err.message);
      return;
    }

    // Reload some states, we are successful
    this.representativeModel = '';
    this.showEditRepresentative = false;

    const accountInfo = await this.api.accountInfo(this.accountID);
    this.account = accountInfo;
    const newRep = this.repService.getRepresentative(repAccount);
    this.repLabel = newRep ? newRep.name : '';

    this.notifications.sendSuccess(`Successfully changed representative`);
  }

  async saveAddressBook() {
    const addressBookName = this.addressBookModel.trim();
    if (!addressBookName) {
      // Check for deleting an entry in the address book
      if (this.addressBookEntry) {
        this.addressBook.deleteAddress(this.accountID);
        this.notifications.sendSuccess(`Successfully removed address book entry!`);
        this.addressBookEntry = null;
      }

      this.showEditAddressBook = false;
      return;
    }

    try {
      await this.addressBook.saveAddress(this.accountID, addressBookName);
    } catch (err) {
      this.notifications.sendError(err.message);
      return;
    }

    this.notifications.sendSuccess(`Saved address book entry!`);

    this.addressBookEntry = addressBookName;
    this.showEditAddressBook = false;
  }

  searchRepresentatives() {
    if (this.representativeModel !== '' && !this.util.account.isValidAccount(this.representativeModel)) this.repStatus = 0;
    else this.repStatus = null;

    this.showRepresentatives = true;
    const search = this.representativeModel || '';

    const matches = this.representativeList
      .filter(a => a.name.toLowerCase().indexOf(search.toLowerCase()) !== -1)
      .slice(0, 5);

    this.representativeResults$.next(matches);
  }

  selectRepresentative(rep) {
    this.showRepresentatives = false;
    this.representativeModel = rep;
    this.searchRepresentatives();
    this.validateRepresentative();
  }

  async validateRepresentative() {
    setTimeout(() => this.showRepresentatives = false, 400);
    this.representativeModel = this.representativeModel.replace(/ /g, '');

    if (this.representativeModel === '') {
      this.representativeListMatch = '';
      return;
    }

    const rep = this.repService.getRepresentative(this.representativeModel);
    const ninjaRep = await this.ninja.getAccount(this.representativeModel);

    if (rep) {
      this.representativeListMatch = rep.name;
    } else if (ninjaRep) {
      this.representativeListMatch = ninjaRep.alias;
    } else {
      this.representativeListMatch = '';
    }
  }

  copied() {
    this.notifications.sendSuccess(`Successfully copied to clipboard!`);
  }

  // Remote signing methods
  // An update to the Nano amount, sync the fiat value
  syncFiatPrice() {
    if (!this.validateAmount()) return;
    const rawAmount = this.getAmountBaseValue(this.amount || 0).plus(this.amountRaw);
    if (rawAmount.lte(0)) {
      this.amountFiat = 0;
      return;
    }

    // This is getting hacky, but if their currency is bitcoin, use 6 decimals, if it is not, use 2
    const precision = this.settings.settings.displayCurrency === 'BTC' ? 1000000 : 100;

    // Determine fiat value of the amount
    const fiatAmount = this.util.nano.rawToMnano(rawAmount)
    .times(this.price.price.lastPrice)
    .times(precision)
    .floor().div(precision).toNumber();

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
    const addressBook = this.addressBook.addressBook;

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

  async validateDestination() {
    // The timeout is used to solve a bug where the results get hidden too fast and the click is never registered
    setTimeout(() => this.showAddressBook = false, 400);

    // Remove spaces from the account id
    this.toAccountID = this.toAccountID.replace(/ /g, '');

    this.addressBookMatch = this.addressBook.getAccountName(this.toAccountID);

    // const accountInfo = await this.walletService.walletApi.accountInfo(this.toAccountID);
    this.toAccountStatus = null;
    if (this.util.account.isValidAccount(this.toAccountID)) {
      const accountInfo = await this.api.accountInfo(this.toAccountID);
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

  validateAmount() {
    if (this.util.account.isValidNanoAmount(this.amount)) {
      this.amountStatus = 1;
      return true;
    } else {
      this.amountStatus = 0;
      return false;
    }
  }

  setMaxAmount() {
    this.amountRaw = this.account.balance ? new BigNumber(this.account.balance).mod(this.nano) : new BigNumber(0);
    const nanoVal = this.util.nano.rawToNano(this.account.balance).floor();
    const maxAmount = this.getAmountValueFromBase(this.util.nano.nanoToRaw(nanoVal));
    this.amount = maxAmount.toNumber();
    this.syncFiatPrice();
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

  async generateSend() {
    const isValid = this.util.account.isValidAccount(this.toAccountID);
    if (!isValid) return this.notifications.sendWarning(`To account address is not valid`);
    if (!this.accountID || !this.toAccountID) return this.notifications.sendWarning(`From and to account are required`);
    if (!this.validateAmount()) return this.notifications.sendWarning(`Invalid NANO Amount`);

    this.qrCodeImageBlock = null;

    const from = await this.api.accountInfo(this.accountID);
    const to = await this.api.accountInfo(this.toAccountID);
    if (!from) return this.notifications.sendError(`From account not found`);

    from.balanceBN = new BigNumber(from.balance || 0);
    to.balanceBN = new BigNumber(to.balance || 0);

    this.fromAccount = from;
    this.toAccount = to;

    const rawAmount = this.getAmountBaseValue(this.amount || 0);
    this.rawAmount = rawAmount.plus(this.amountRaw);

    const nanoAmount = this.rawAmount.div(this.nano);

    if (this.amount < 0 || rawAmount.lessThan(0)) return this.notifications.sendWarning(`Amount is invalid`);
    if (from.balanceBN.minus(rawAmount).lessThan(0)) return this.notifications.sendError(`From account does not have enough NANO`);

    // Determine a proper raw amount to show in the UI, if a decimal was entered
    this.amountRaw = this.rawAmount.mod(this.nano);

    // Determine fiat value of the amount
    this.amountFiat = this.util.nano.rawToMnano(rawAmount).times(this.price.price.lastPrice).toNumber();

    const remaining = new BigNumber(from.balance).minus(this.rawAmount);
    const remainingDecimal = remaining.toString(10);

    const defaultRepresentative = this.settings.settings.defaultRepresentative || this.nanoBlock.getRandomRepresentative();
    const representative = from.representative || defaultRepresentative;
    const blockData = {
      account: this.accountID.replace('xrb_', 'nano_').toLowerCase(),
      previous: from.frontier,
      representative: representative,
      balance: remainingDecimal,
      link: this.util.account.getAccountPublicKey(this.toAccountID),
    };
    this.blockHash = nanocurrency.hashBlock({
      account: blockData.account,
      link: blockData.link,
      previous: blockData.previous,
      representative: blockData.representative,
      balance: blockData.balance
    });
    console.log('Created block', blockData);
    console.log('Block hash: ' + this.blockHash);

    // Previous block info
    const previousBlockInfo = await this.api.blockInfo(blockData.previous);
    if (!('contents' in previousBlockInfo)) return this.notifications.sendError(`Previous block not found`);
    const jsonBlock = JSON.parse(previousBlockInfo.contents);
    const blockDataPrevious = {
      account: jsonBlock.account.replace('xrb_', 'nano_').toLowerCase(),
      previous: jsonBlock.previous,
      representative: jsonBlock.representative,
      balance: jsonBlock.balance,
      link: jsonBlock.link,
      signature: jsonBlock.signature,
    };

    // Nano signing standard
    this.qrString = 'nanosign:{"block":' + JSON.stringify(blockData) + ',"previous":' + JSON.stringify(blockDataPrevious) + '}';
    const qrCode = await QRCode.toDataURL(this.qrString, { errorCorrectionLevel: 'L', scale: 16 });
    this.qrCodeImageBlock = qrCode;
  }

  async generateReceive(pendingHash) {
    this.qrCodeImageBlockReceive = null;
    this.qrString = null;
    this.blockHashReceive = null;

    const UIkit = window['UIkit'];
    const modal = UIkit.modal('#receive-modal');
    modal.show();

    const toAcct = await this.api.accountInfo(this.accountID);

    const openEquiv = !toAcct || !toAcct.frontier; // if open block

    const previousBlock = toAcct.frontier || this.zeroHash; // set to zeroes if open block
    const defaultRepresentative = this.settings.settings.defaultRepresentative || this.nanoBlock.getRandomRepresentative();
    const representative = toAcct.representative || defaultRepresentative;

    const srcBlockInfo = await this.api.blocksInfo([pendingHash]);
    const srcAmount = new BigNumber(srcBlockInfo.blocks[pendingHash].amount);
    const newBalance = openEquiv ? srcAmount : new BigNumber(toAcct.balance).plus(srcAmount);
    const newBalanceDecimal = newBalance.toString(10);

    const blockData = {
      account: this.accountID.replace('xrb_', 'nano_').toLowerCase(),
      previous: previousBlock,
      representative: representative,
      balance: newBalanceDecimal,
      link: pendingHash,
    };

    this.blockHashReceive = nanocurrency.hashBlock({
      account: blockData.account,
      link: blockData.link,
      previous: blockData.previous,
      representative: blockData.representative,
      balance: blockData.balance
    });
    console.log('Created block', blockData);
    console.log('Block hash: ' + this.blockHashReceive);

    // Previous block info
    let blockDataPrevious = null;
    if (!openEquiv) {
      const previousBlockInfo = await this.api.blockInfo(blockData.previous);
      if (!('contents' in previousBlockInfo)) return this.notifications.sendError(`Previous block not found`);
      const jsonBlock = JSON.parse(previousBlockInfo.contents);
      blockDataPrevious = {
        account: jsonBlock.account.replace('xrb_', 'nano_').toLowerCase(),
        previous: jsonBlock.previous,
        representative: jsonBlock.representative,
        balance: jsonBlock.balance,
        link: jsonBlock.link,
        signature: jsonBlock.signature,
      };
    }

    let qrData;
    if (blockDataPrevious) {
      qrData = {
        block: blockData,
        previous: blockDataPrevious
      };
    } else {
      qrData = {
        block: blockData
      };
    }

    // Nano signing standard
    this.qrString = 'nanosign:' + JSON.stringify(qrData);

    const qrCode = await QRCode.toDataURL(this.qrString, { errorCorrectionLevel: 'L', scale: 16 });
    this.qrCodeImageBlockReceive = qrCode;
  }

  async generateChange() {
    if (!this.util.account.isValidAccount(this.representativeModel)) return this.notifications.sendError(`Not a valid representative account`);
    this.qrCodeImageBlock = null;
    this.blockHash = null;
    this.qrString = null;

    const account = await this.api.accountInfo(this.accountID);

    if (!account || !('frontier' in account)) return this.notifications.sendError(`Account must be opened first!`);

    const balance = new BigNumber(account.balance);
    const balanceDecimal = balance.toString(10);
    const blockData = {
      account: this.accountID.replace('xrb_', 'nano_').toLowerCase(),
      previous: account.frontier,
      representative: this.representativeModel,
      balance: balanceDecimal,
      link: this.zeroHash,
    };

    this.blockHash = nanocurrency.hashBlock({
      account: blockData.account,
      link: blockData.link,
      previous: blockData.previous,
      representative: blockData.representative,
      balance: blockData.balance
    });

    console.log('Created block', blockData);
    console.log('Block hash: ' + this.blockHash);

    // Previous block info
    const previousBlockInfo = await this.api.blockInfo(blockData.previous);
    if (!('contents' in previousBlockInfo)) return this.notifications.sendError(`Previous block not found`);
    const jsonBlock = JSON.parse(previousBlockInfo.contents);
    const blockDataPrevious = {
      account: jsonBlock.account.replace('xrb_', 'nano_').toLowerCase(),
      previous: jsonBlock.previous,
      representative: jsonBlock.representative,
      balance: jsonBlock.balance,
      link: jsonBlock.link,
      signature: jsonBlock.signature,
    };

    // Nano signing standard
    this.qrString = 'nanosign:{"block":' + JSON.stringify(blockData) + ',"previous":' + JSON.stringify(blockDataPrevious) + '}';
    const qrCode = await QRCode.toDataURL(this.qrString, { errorCorrectionLevel: 'L', scale: 16 });
    this.qrCodeImageBlock = qrCode;
  }

  showRemote(state: boolean) {
    this.remoteVisible = !state;
  }

  showRemoteModal() {
    const UIkit = window['UIkit'];
    const modal = UIkit.modal('#block-modal');
    modal.show();
    this.clearRemoteVars();
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
        case 'rep1':
          this.representativeModel = data.content;
          this.validateRepresentative();
          break;
      }
    }, () => {}
    );
  }

  resetRaw() {
    this.amountRaw = new BigNumber(0);
  }

  // End remote signing methods

}
