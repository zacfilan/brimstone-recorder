import {uuidv4} from './utilities.js'

export class Rectangle {
    _coords = [];

    constructor(coords) {
        this._coords = coords;
        const rectangle = document.createElement("div");
        rectangle.classList.add('rectangle');
        rectangle.style.position = "absolute";
        rectangle.style.backgroundColor = "rgba(204,230,255, 0.7)";
        rectangle.style.border = "1px dashed black";
        Rectangle.container.appendChild(rectangle);
        rectangle.addEventListener("mousedown", e => {
            if (e.button === 2) {
                e.preventDefault();
                e.stopPropagation();
                rectangle.remove();
            }
        });
        this.rectangle = rectangle;
        Rectangle.instances.push(rectangle);
        this.redraw();
    }

    get topLeftCoords() {
        return this._coords[0];
    }

    get bottomRightCoords() {
        return this._coords[1];
    }

    redraw() {
        const top = Math.min(this._coords[0].y, this._coords[1].y);
        const height = Math.max(this._coords[0].y, this._coords[1].y) - top;
        const left = Math.min(this._coords[0].x, this._coords[1].x);
        const width = Math.max(this._coords[0].x, this._coords[1].x) - left;
        this.rectangle.style.top = top + "px";
        this.rectangle.style.height = height + "px";
        this.rectangle.style.left = left + "px";
        this.rectangle.style.width = width + "px";
    };
}

Rectangle.container = document.body;
Rectangle._resizing = false;
Rectangle.instances = [];
Rectangle.setContainer = function (container, addCallback, delCallback) {
    Rectangle.container = container;
    container.addEventListener("mousedown", e => {
        if (e.button !== 0) return;
        Rectangle._resizing = new Rectangle([{ x: e.clientX, y: e.clientY }, { x: e.clientX, y: e.clientY }]);
    });

    container.addEventListener("mousemove", e => {
        if (Rectangle._resizing) {
            Rectangle._resizing._coords[1] = { x: e.clientX, y: e.clientY };
            Rectangle._resizing.redraw();
        }
    });

    container.addEventListener("mouseup", e => {
        if (e.button !== 0) return;
        if (Rectangle._resizing) {
            Rectangle._resizing._coords[1] = { x: e.clientX, y: e.clientY };
            Rectangle._resizing.redraw();
            addCallback({
                coords: Rectangle._resizing._coords,
                uid: uuidv4()
            }); // this one is now added, so callback
            Rectangle._resizing = null;
        }
    });
}




