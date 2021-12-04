
export class MenuController {
    /** remember if the menu is open or not */
    opened = false;

    /** close the menu */
    close() {
        $('#menu .options').hide();
    }

    constructor(actions) {
        this.actions = actions;
        this.close();

        /** click on an actionable menu item */
        $('#menu .options .option').on('click', (e) => {
            let action = $(e.target).closest('.option').attr('data-action');
            this.close();
            this.actions[action](); // execute the action
        });

        /** open or close a menu */
        $('#menu > .option').on('click', (e) => {
            if (!this.opened) {
                $(e.target).find(" > .options").show();
                this.opened = true;
            }
            else {
                this.opened = false;
                $('#menu .options').hide();
            }
        });

        /** mousein/out on menu title */
        $('#menu > .option').hover(
            (e) => { // mousein
                if (this.opened) {
                    this.close();
                    $(e.target).find(" > .options").show();
                }
            },
            (e) => { // mouseout
                $(e.target).find(" > .options").hide();
            }
        );
    }
}