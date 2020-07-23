import {AfterViewInit, Component, OnInit} from '@angular/core';
import {RepresentativeService} from "../../services/representative.service";
import {Router} from "@angular/router";
import { NinjaService } from "../../services/ninja.service";

@Component({
  selector: 'app-change-rep-widget',
  templateUrl: './change-rep-widget.component.html',
  styleUrls: ['./change-rep-widget.component.css']
})
export class ChangeRepWidgetComponent implements OnInit, AfterViewInit {

  changeableRepresentatives = this.repService.changeableReps;
  representatives = [];
  showRepHelp = false;
  modalElement = null;
  suggestedRep = {
    alias: '',
    account: ''
  };

  constructor(
    private repService: RepresentativeService,
    private router: Router,
    private ninja: NinjaService
    ) { }

  async ngOnInit() {
    this.representatives = await this.repService.getRepresentativesOverview();

    this.repService.walletReps$.subscribe(async reps => {
      this.representatives = reps;
      console.log('GOT REPS: ', this.representatives);
    });

    console.log('INITIAL REPS:', this.representatives);

    await this.repService.detectChangeableReps();

    this.repService.changeableReps$.subscribe(async reps => {
      this.changeableRepresentatives = reps;

      if (reps.length > 0) {
        this.suggestedRep = await this.ninja.getSuggestedRep();
      }
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  ngAfterViewInit() {
    const UIkit = window['UIkit'];
    this.modalElement = UIkit.modal('#change-rep-modal');
  }

  showModal() {
    this.modalElement.show();
  }

  closeModal() {
    this.modalElement.hide();
  }

  navigateToRepChangePage() {
    this.router.navigate(['/representatives']);
  }

  changeReps() {
    const allAccounts = this.changeableRepresentatives.map(rep => rep.accounts.map(a => a.id).join(',')).join(',');

    this.modalElement.hide();

    this.router.navigate(['/representatives'], { queryParams: { hideOverview: true, accounts: allAccounts, showRecommended: true } });
  }

  changeToRep(representative) {
    const allAccounts = this.changeableRepresentatives.map(rep => rep.accounts.map(a => a.id).join(',')).join(',');

    this.modalElement.hide();

    this.router.navigate(['/representatives'], { queryParams: { accounts: allAccounts, representative: representative } });
  }

}
