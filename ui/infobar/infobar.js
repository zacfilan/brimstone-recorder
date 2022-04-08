'use strict';

import { extensionInfo } from '../brimstoneDataService.js';

class InfoBar {
  setText(infobarText) {
    if (!infobarText) {
      if ($('#recordButton').hasClass('active')) {
        infobarText = '<span class="pulse">🔴</span> recording...';
      } else if ($('#playButton').hasClass('active')) {
        infobarText = '🟢 playing...';
      } else {
        infobarText = 'ready';
      }
    }
    this.setHtml(extensionInfo.version + ' ' + infobarText);
  }

  setHtml(html) {
    $('#infobar').html(html);
  }

  /**
   * Displays a progress bar in the info bar with the
   * fraction of the passed in parameters shown as complete.
   * @param {number} value
   * @param {number} max
   */
  setProgress(label, complete, value, max) {
    if (value === max) {
      this.setHtml(`${extensionInfo.version} ${complete} ${value}/${max}`);
    } else {
      this.setHtml(
        `${extensionInfo.version} ${label} ${value}/${max} <progress max="${max}" value="${value}"></progress>`
      );
    }
  }
}

export let infobar = new InfoBar();
