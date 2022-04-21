/**
 * @callback userCallback
 * @param {Event} event the event
 */
import { TestAction } from '../../test.js';

export class ActionGutter {
  /**
   *
   * @param {object} args
   * @param {string} args.element the element to create the ActionGutter on
   * @param {userCallback} args.click click callback
   * @param {userCallback} args.mouseenter mouseenter callback
   * @param {userCallback} args.mouseleave mouseleave callback
   */
  constructor({
    element = null,
    click = null,
    mouseenter = null,
    mouseleave = null,
  }) {
    $(element).replaceWith(
      '<div id="_thumbGutter"></div><div id="_actionGutter"></div>'
    );
    /** public access to the thumbGutter element */
    this.thumbGutter = $('#_thumbGutter');
    /** public access to the actionGutter element */
    this.actionGutter = $('#_actionGutter');
    if (click) {
      this.actionGutter.on(
        'click',
        'button',
        /** When the user clicks on the thumbnail put that step in the main area. */
        click.bind(this)
      );
    }
    if (mouseenter) {
      this.actionGutter.on('mouseenter', 'button', mouseenter.bind(this));
    }
    if (mouseleave) {
      this.actionGutter.on('mouseleave', 'button', mouseleave.bind(this));
    }
  }

  /** Clean the gutters */
  clean() {
    // clear the thumbnails
    this.thumbGutter.empty();
    this.actionGutter.empty();
  }

  /**
   * draw the gutter based on the the
   * actions passed in.
   * @param {TestAction[]} actions the actions to draw
   */
  draw(actions = []) {
    this.clean();
    for (let i = 0; i < actions.length; ++i) {
      let action = actions[i];
      let classes = '';
      if (action.dirty) {
        classes += ' dirty';
      }
      if (action.acceptablePixelDifferences) {
        classes += ' fixed';
      }
      if (action.inserted) {
        classes += ' inserted';
      }
      if (action._match === 'fail') {
        classes += ' fail';
      }
      this.actionGutter.append(
        `<button index=${i} class="${classes}">${i + 1}</button>`
      );
    }
  }

  setCurrent(index) {
    this.actionGutter.find('button').removeClass('current');
    let current = this.actionGutter.find(`button[index=${index}]`);
    if (current.length) {
      current.addClass('current');
      this.actionGutter[0].scrollTo(
        current[0].offsetLeft,
        current[0].offsetTop
      );
    }
  }

  setFail(index) {
    this.actionGutter.find('button').removeClass('fail');
    this.actionGutter.find(`button[index=${index}]`).addClass('fail');
  }

  clearFail() {
    this.actionGutter.find('button').removeClass('fail');
  }
}
