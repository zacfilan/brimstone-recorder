

var screenshotCounter = 0;
// grab the parent window id from the query parameter
const urlParams = new URLSearchParams(window.location.search);
const parentWindowId = parseInt(urlParams.get('parent'),10);
var uiCardsElement = document.getElementById('cards');
// /** Take a data url for a PNG and save it to users filesystem */
// async function savePng(dataUrl) {
//     let response = await fetch(dataUrl); 
//     let blob = await response.blob();

//     // I want to zip up all the images as I go
//     const handle = await window.showSaveFilePicker({
//         suggestedName: `screenshot${++screenshotCounter}.png`,
//         types: [
//             {
//                 description: 'A PNG',
//                 accept: {'image/png': ['.png']}
//             }
//         ]
//     }); 
//     const writable = await handle.createWritable();    
//     await writable.write(blob);  // Write the contents of the file to the stream.    
//     await writable.close(); // Close the file and write the contents to disk.
// }

// /**
//  * Add the step to the UI
//  * @param {Step} step The step to add 
//  */
// function addStep(step) {
// }

// class UserAction {

// }

// class Step {

//     constructor(args) {
//         /** @type string */
//         this.dataUrl = args.dataUrl;
//         /** @type UserAction[] */
//         this.events = [];
//     }
// } 

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function screenShotHtml(args) {
    let html = '';
    args.guids = [];
    if(args.dataUrl) {  
        html += 
            `<div class='screenshot'>
                <img src='${args.dataUrl}'>
            `;
        args.overlays.forEach(e => {
            // the overlays should come in with these properties already as percentages
            let guid = uuidv4();
            html += `<div class='overlay' data-uid=${guid} style='height:${e.height};width:${e.width};top:${e.top};left:${e.left}'></div>`;
            args.guids.push(guid);
        });
    }
    else {
        html += 
            `<div id='shutterButton' class='screenshot'>
                Click to take screen shot
            </div>`;
    }
    return html;
}

function userEventsHtml(args) {
    let html = `<div class='user-events'>`;
    if(args.guids) {
        args.guids.forEach(guid => {
            html += `<div class='user-event' data-uid='${guid}'>event</div>`;
        });
    }
    html += '</div>';
    return html;
}

function cardHtml(args = {}) {
    let html = '';
    html += '<div class="card">';
    html += screenShotHtml(args);
    html += userEventsHtml(args);
    html += '</div>';
    return html;
}

function addCard(card = cardHtml()) {
    $('#cards').append(card);
}

// chrome.storage.local.set({ brimstoneScreenshot: dataUrl});
    // await chrome.scripting.executeScript({
    //     target: { tabId: tab.id },
    //     function: writeScreenShotToLocalStorage,
    // });


$('#cards').on('mouseenter mouseleave', '.user-event', function(e) {
    $(`.overlay[data-uid='${e.target.dataset.uid}']`).toggle();
});

// when an image is done loading then scroll 
$('#cards').on('load', 'img', function(e) {

});

$('#cards').on('click', '#shutterButton', async function(e) {
    let dataUrl = await chrome.tabs.captureVisibleTab(parentWindowId, {
        format: 'png'
    }); // e.g. dataUrl === 'data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...'
    // let userActions = [new UserAction()];

    // remove the shutter and replace it with a screenshot
    let blankCard = $('#shutterButton').closest('.card'); 
    let screenShotCard = $(cardHtml({
        dataUrl,
        overlays: [
            {height:'10%', width:'20%', top: '50%', left: '50%'},
            {height:'30%', width:'30%', top: '0%', left: '0%'}
        ]
    }));

    screenShotCard.find('img').on('load', function(e) {
        console.group('image loaded, scrolling now!');
        blankCard = $('#shutterButton').closest('.card'); // it moved
        let position = blankCard.position(); 
        uiCardsElement.scrollBy(position.left, 0);
    });

    screenShotCard.insertBefore(blankCard);
});

addCard();

// /**
//  * Injected into the app to store the screenshot into localstorage for the current domain
//  * @param {string} dataUrl Base64 encoded image
//  */
//  function writeScreenShotToLocalStorage(dataUrl) {
//     // content scripts can access chrome storage API, https://developer.chrome.com/docs/extensions/reference/storage/
//     // this is used to "pass arguments" from the popup context into function injeted into the webpage context
//     chrome.storage.local.get(['brimstoneScreenshot'],
//         (entry) => localStorage.setItem('brimstoneScreenshot', entry.brimstoneScreenshot));
// }

// REFERENCES
// Getting sarted with an extension
//    https://developer.chrome.com/docs/extensions/mv3/getstarted/
// headless recorder chrome extension
//    https://chrome.google.com/webstore/detail/headless-recorder/djeegiggegleadkkbgopoonhjimgehda?hl=en
// Chrome extension APIs 
//     https://developer.chrome.com/extensions/tabs#method-captureVisibleTab
// HTML5 fetch
//     https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
//     https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch
// HTML5 file system access
//     https://web.dev/file-system-access/ 
//     https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker
// Webpack
//     https://webpack.js.org/
// adm-zip
//     https://www.npmjs.com/package/adm-zip