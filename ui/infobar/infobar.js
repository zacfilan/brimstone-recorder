'use strict';

import * as extensionInfo from '../extensionInfo.js';

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
    let chromeIcon = `chrome${
      extensionInfo.chromeVersion.includes('beta') ? '_beta' : ''
    }_icon.png`;
    let title = extensionInfo.chromeVersion;
    this.setHtml(`
      <div class="text">${extensionInfo.version} ${infobarText}</div>
      <div title="${title}" class="right">
        <img src="/images/${chromeIcon}">
        <div class="text">${extensionInfo.chromeBuild}</div>
      </div>
      `);
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
