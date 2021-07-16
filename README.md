
# What?

Brimstone is a web application test recorder, test player and **pixel-perfect** test validator all in one.

1. Fire up the brimstone workspace for the current tab.
2. Record some actions.
3. Play the test back anytime, validate the app still works and looks *exactly* like it did when the test was recorded.

Brimstone is a strict do no harm tester: it requires every pixel to be accounted for.

# Why?

We required effective, easy, automated do-no-harm testing to catch the most bugs between different code versions of a complex single page web application. This testing needed to be done by non-technical employees. (And I wanted to do something fun.)

# How?

Brimstone records screenshots of every user action performed. When a user performs an action she is implicitly indicating that the screen is in the expected completed state of the *previous* user action performed. In this way, the user implicitly determines the screen states required between actions. Brimstone uses this information during playback to determine timing and correctness of each user action.

Brimstone uses the [chrome devtools protocol](https://chromedevtools.github.io/devtools-protocol/1-3) (CDP) via the [chrome.debugger](https://developer.chrome.com/docs/extensions/reference/debugger/) chrome extension API to control the browser. 

# Who?

The intended audience is quality engineers, web-software developers, automation engineers, and you. :)

# Recording

Still here? Cool. Go to some website. Poke the (B) icon to start recording on this tab.  

## Recording Tips, Dos and Don'ts.

* Do type slower than normal.

    Try using one finger, especially if each keystroke can update a chunk of the screen - some searches and filters do this. Brimstone is doing stuff, including taking a screenshot, for each key you press. If you perform too many user input actions too fast, some events may be missed.
    
* Do avoid tooltips. 

    Don't linger with the mouse. Brimstone doesn't yet time how long you hover over an element before clicking it, so it doesn't simulate that delay when playing back. Hence if you generate a tooltip while recording, you probably won't see it when playing back, and will get a screen mismatch. (I will fix this.)

* Do always end your recording by pressing the 'End Recording' button.

* Do save and organize your recordings.

* Don't move the mouse when you don't need to.

    Although I am in the habit of wiggling the mouse around while I wait for the next screen to render, don't do this when recording in Brimstone. Brimstone uses user input as clues for when the screen is ready, and it's possible to confuse it if you move the mouse around when you don't need to.





## FAQ
1. How do I record things which pop up on hover, like certain menus?

    Menus that pop up on hover can be recorded by holding down the Ctrl key, moving to the location that pops up the menu, then releasing the Ctrl key.

2. Why can't I record a maximized tab?

    Brimstone uses the [chrome.debugger](https://developer.chrome.com/docs/extensions/reference/debugger/) API, which injects a banner into the browser. You need to leave some space for it.

3. Why do I get "You must close the existing debugger first" alerts when I try to record or play?

    You can't start a recording or playback if there is already a debugger attached. Brimstone uses the [chrome.debugger](https://developer.chrome.com/docs/extensions/reference/debugger/) API, and can't reuse an existing connection. You can attach anohter debugger **after** the recording or playback has started though.


# Playing

You can play back right after you end a recording, or when you load a saved test.

* Playing will reuse the tab the workspace was launched from.
Make sure that your tab will 

# Validating 

## Correcting

# Limitations
This list is subject to change, and will probably transition to a bug/issue tracked. Nothing's perfect man. But we're trying.  
 
* Each test is recorded and played back in a fixed resolution. If you want to test different resoutions you need to record different tests.
* Only user actions in the page itself are recorded. e.g. The browser back and forward buttons are not recorded.
* Only click, double-click, right-click, and single-keypresses are recorded. e.g. Chords like Ctrl-A are not (yet) recorded.
* Only one tab is recorded in a test, although that tab is free to navigate to different URLs and still be recorded. e.g. Web application spawned browser windows/tabs are not included in the current recording.



