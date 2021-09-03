import { Pipe, PipeTransform } from '@angular/core';
import BigNumber from 'bignumber.js';

@Pipe({
  name: 'rai'
})
export class RaiPipe implements PipeTransform {
  precision = 2;

  transform(value: any, args?: any): any {
    const opts = args.split(',');
    const denomination = opts[0] || 'ana';
    const hideText = opts[1] || false;

    switch (denomination.toLowerCase()) {
      default:
      case 'ana': return `${new BigNumber(value).shift(-28).toFixed(this.precision)}${!hideText ? ' ANA' : ''}`;
      case 'kana': return `${new BigNumber(value).shift(-31).toFixed(this.precision+3)}${!hideText ? ' ANA' : ''}`;
      case 'mana': return `${new BigNumber(value).shift(-34).toFixed(this.precision+6)}${!hideText ? ' ANA' : ''}`;
      case 'raw': return `${value}${!hideText ? ' RAW' : ''}`;
      case 'dynamic':
        const raw = new BigNumber(value)
        const ana = raw.shift(-28)
        if (ana.lessThan(10**(-this.precision))) {
          // raw
          return this.transform(value, "raw,"+hideText);
        } else if (ana.lessThan(1e3)) {
          // ana
          return this.transform(value, "ana,"+hideText)
        } else if (ana.lessThan(1e6)) {
          // ana
          return this.transform(value, "kana,"+hideText)
        } else {
          // mana
          return this.transform(value, "mana,"+hideText)
        }
    }
  }

}
