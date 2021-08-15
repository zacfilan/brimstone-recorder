
class Tip {
    constructor({title, tip}) {
        this.title = title;
        this.tip = tip;
    }
}

const tips = [
    {
        title: 'Help available',
        tip: 'Brimstone has an online searchable wiki. Click the (?) icon in the top toolbar.'
    },
    {
        title: 'Recording keystrokes',
        tip: 'Type much slower than normal. Fast typing will cause problems.'
    },
    {
        title: 'Recording scolling',
        tip: "Use the mousewheel slowly. You can't record scrolling via mousedrag on the scrollbar slider."
    },
    {
        title: 'End recording cleanly',
        tip: "Always end your recording by pressing the 'End Recording' button. This adds the last screenshot."
    },
    {
        title: 'Save tests',
        tip: 'Use the diskette icon to save and organize your test recordings into folders.'
    },
    {
        title: "Don't fidget with the mouse",
        tip: "Only move the mouse when it is needed for the user action you are recording. Brimstone uses your movement of the mouse as an indication that the screen is ready for your next user action."
    },
    {
        title: "Shadow DOM woes",
        tip: "Brimstone cannot record inside of shadow DOM components. See the shadow DOM section in the help."
    }


]