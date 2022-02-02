
export class MenuController {
    /** remember if the menu is open or not */
    opened = false;

    /** close the menu */
    close() {
        $('#menus .options').removeClass('open');
    }

    /**
     * 
     * @param {Actions} actions 
     */
    constructor(actions) {
        this.actions = actions;
        this.close();

        /** click on an actionable menu item */
        $('#menus .options .option').on('click', (e) => {
            let action = $(e.target).closest('.option').attr('data-action');
            this.close();
            this.actions.callMethodNameByUser(action); // execute the action
        });

        /** open or close a menu */
        $('#menus > .option').on('click', (e) => {
            if (!this.opened) {
                $(e.target).find(" > .options").addClass('open');
                this.opened = true;
            }
            else {
                this.opened = false;
                $('#menus .options').removeClass('open');
            }
        });

        /** mousein/out on menu title */
        $('#menus > .option').hover(
            (e) => { // mousein
                if (this.opened) {
                    this.close();
                    $(e.target).find(" > .options").addClass('open');
                }
            },
            (e) => { // mouseout
                $(e.target).find(" > .options").removeClass('open');
            }
        );
    }
}