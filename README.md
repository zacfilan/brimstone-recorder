
# What?

Brimstone is a web application test recorder, test player and **pixel-perfect** test validator all in one.

1. Fire up the brimstone workspace for the current tab.
2. Record some actions.
3. Play the test back anytime, validate the app still works and looks *exactly* like it did when the test was recorded.

Brimstone is a strict do no harm tester: it requires every pixel to be accounted for.

# Why?

We required an easy, automated do-no-harm testing methodology to catch the most bugs between different code versions of a complex single page web application. This testing needed to be done by non-technical employees. (And I wanted to do something fun.)

# How?

Brimstone records screenshots of every user action performed. When a user performs an action she is implicitly indicating that the screen is in the expected completed state of the *previous* user action performed. In this way, the user implicitly determines the screen states required between actions. Brimstone uses this information during playback to determine timing and correctness of each user action.

Brimstone uses the [chrome devtools protocol](https://chromedevtools.github.io/devtools-protocol/1-3) (CDP) via the [chrome.debugger](https://developer.chrome.com/docs/extensions/reference/debugger/) chrome extension API to control the browser. 

# Who?

The intended audience is quality engineers, web-software developers, automation engineers, and you. :)

# Recording

Still here? Cool. Go to some website. Poke the ![Brimstone Icon](/images/grey_b_32.png) icon to launch the workspace.  

## Recording Tips, Dos and Don'ts.

* Do type slower than normal.

    Brimstone is executing code, including taking a screenshot, for each key you press. If you perform too many user input actions too fast, some events may be missed. Some searches and filters update a chunk of the screen each time you press a key. Be aware of that, slow down and look at the screen for a moment between each keypress. 
    
* Do watch the workspace to see what Brimstone recorded for each user action.

* Do always end your recording by pressing the 'End Recording' button.

* Do save and organize your recordings.

* Don't move the mouse unless the screen is actually ready for your next user action.

    Outside of Brimstone, I am in the habit of wiggling the mouse around while I wait for the next screen in the browser to render. I am easily bored. *Don't do this when recording in Brimstone.* Brimstone uses your movement of the mouse as an indication that the screen **is** ready for your next user action. 

## FAQ
1. How do I record scrolling?

    As of 7/21/2021 only mouse wheel scrolling is recorded. Specfically, moving scrollbars with mousedown, mousemove, mouseup will not be interpreted as a scroll user input.

2. Why can't I record a maximized tab?

    Brimstone uses the [chrome.debugger](https://developer.chrome.com/docs/extensions/reference/debugger/) API, which injects a banner into the browser. You need to leave some space for it.

2. Why do I get "You must close the existing debugger first" alerts when I try to record or play?

    You can't start a recording or playback if there is already a developer debugger attached. Brimstone uses the [chrome.debugger](https://developer.chrome.com/docs/extensions/reference/debugger/) API, and can't reuse an existing connection. You can attach a developer debugger **after** the recording or playback has started though.

3. Why does the item **I clicked** have pixel mismatches during playback that look like focus or selected type state styles?

    See [issue 13](https://github.com/zacfilan/brimstone-recorder/issues/13)

    TLDR; Buttons which look different after being clicked will pixel mismatch, mark them as allowable pixel deltas.

4. Why does an item **I didn't click** have pixel mismatches during playback that look like focus or selected type style states?

    This shouldn't happen. You may have moved your mouse while waiting for the screen to render. Re-record that step and verify that you don't move the mouse until the item has the focus you expect.

# Playing

You can play back right after you end a recording, or when you load a saved test.

## Playing Tips, Dos and Don'ts.

* Don't multi-task during playback. Mousing or typing in other applications could affect playback.
    
# Validating 

## Correcting

# Limitations
This list is subject to change, and will probably transition to a bug/issue tracked. Nothing's perfect man. But we're trying.  
 
* Each test is recorded and played back in a fixed resolution. If you want to test different resoutions you need to record different tests.
* Only user actions in the page itself are recorded. e.g. The browser back and forward buttons are not recorded.
* Click, double-click, right-click, single-keypresses, limited chords, and mouse wheel user inputs are recorded. e.g. Chords must start with a Ctrl. e.g. Ctrl-a will be recorded, but I haven' gotten around to Alt-a. 
* Only one tab is recorded in a test, although that tab is free to navigate to different URLs and still be recorded. e.g. Web application spawned additional browser windows/tabs recording is not supported.



