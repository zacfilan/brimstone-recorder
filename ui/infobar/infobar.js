'use strict';

import * as extensionInfo from '../extensionInfo.js';

class InfoBar {
  setText(...items) {
    let chromeIcon = `chrome${
      extensionInfo.chromeVersion.includes('beta') ? '_beta' : ''
    }_icon.png`;
    let html = `<div class="text">${extensionInfo.version}</div>`;

    if (items.length === 0) {
      let item = '';
      if ($('#recordButton').hasClass('active')) {
        html += `
          <span class="pulse">🔴</span>
          <div class="text">recording...</div>
          `;
      } else if ($('#playButton').hasClass('active')) {
        html += '🟢 playing...';
      } else {
        html += '<div class="text">ready</div>';
      }
    } else {
      for (let item of items) {
        if (typeof item === 'string') {
          html += `<div class="text">${item}</div>`;
        } else if (item?.html) {
          html += item?.html;
        }
      }
    }

    let title = extensionInfo.chromeVersion;
    html += `
    <div title="${title}" class="right">
      <img src="/images/${chromeIcon}">
      <div class="text">${extensionInfo.chromeBuild}</div>
    </div>
    `;

    this.setHtml(html);
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
