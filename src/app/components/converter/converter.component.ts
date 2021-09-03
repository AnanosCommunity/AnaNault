import { Component, OnInit, OnDestroy } from '@angular/core';
import {UtilService} from '../../services/util.service';
import {AppSettingsService} from '../../services/app-settings.service';
import * as nanocurrency from 'nanocurrency';
import {PriceService} from '../../services/price.service';
import { BigNumber } from 'bignumber.js';
import {NotificationService} from '../../services/notification.service';

@Component({
  selector: 'app-converter',
  templateUrl: './converter.component.html',
  styleUrls: ['./converter.component.less']
})
export class ConverterComponent implements OnInit, OnDestroy {
  ana = '1';
  raw = '';
  invalidAna = false;
  invalidRaw = false;
  invalidFiat = false;
  fiatPrice = '0';
  priceSub = null;

  constructor(
    private util: UtilService,
    public settings: AppSettingsService,
    private price: PriceService,
    public notifications: NotificationService,
  ) { }

  ngOnInit(): void {
    BigNumber.config({ DECIMAL_PLACES: 30 });
    this.ana = '1';

    this.priceSub = this.price.lastPrice$.subscribe(event => {
      this.fiatPrice = "0"//(new BigNumber(this.ana)).times(this.price.price.lastPrice).toString();
    });

    this.unitChange('ana');
  }

  ngOnDestroy() {
    if (this.priceSub) {
      this.priceSub.unsubscribe();
    }
  }

  unitChange(unit) {
    switch (unit) {
      case 'ana':
        if (this.util.account.isValidNanoAmount(this.ana)) {
          this.raw = new BigNumber(this.ana).shift(28).toFixed()
          this.fiatPrice = "0"//(new BigNumber(this.Mnano)).times(this.price.price.lastPrice).toString(10);
          this.invalidAna = false;
          this.invalidRaw = false;
          this.invalidFiat = false;
        } else {
          this.raw = '';
          this.fiatPrice = '';
          this.invalidAna = true;
        }
        break;
      case 'raw':
        if (this.util.account.isValidAmount(this.raw)) {
          this.ana = new BigNumber(this.raw).shift(-28).toFixed()
          this.fiatPrice = "0"//(new BigNumber(this.Mnano)).times(this.price.price.lastPrice).toString(10);
          this.invalidRaw = false;
          this.invalidAna = false;
          this.invalidFiat = false;
        } else {
          this.ana = '';
          this.fiatPrice = '';
          this.invalidRaw = true;
        }
        break;
      case 'fiat':
        if (this.util.string.isNumeric(this.fiatPrice)) {
          this.ana = "0"//(new BigNumber(this.fiatPrice)).dividedBy(this.price.price.lastPrice).toString(10);
          this.raw = "0"//nanocurrency.convert(this.Mnano, {from: nanocurrency.Unit.NANO, to: nanocurrency.Unit.raw});
          this.invalidRaw = false;
          this.invalidAna = false;
          this.invalidFiat = false;
        } else {
          this.ana = '';
          this.raw = '';
          this.invalidFiat = true;
        }
        break;
    }
  }

}
