"use strict";

import * as BDS from "./brimstoneDataService.js";

class InfoBar {
    installType = '';

    setText(infobarText) {
        if (!infobarText) {
            if ($('#recordButton').hasClass('active')) {
                infobarText = '<span class="pulse">🔴</span> recording...';
            }
            else if ($('#playButton').hasClass('active')) {
                infobarText = '🟢 playing...';
            }
            else {
                infobarText = 'ready';
            }
        }
        this.setHtml(this.installType + BDS.brimstoneVersion + ' ' + infobarText);
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
            this.setHtml(`${this.installType}${BDS.brimstoneVersion} ${complete} ${value}/${max}`);
        }
        else {
            this.setHtml(`${this.installType}${BDS.brimstoneVersion} ${label} ${value}/${max} <progress max="${max}" value="${value}"></progress>`);
        }
    }
}

export let infobar = new InfoBar();