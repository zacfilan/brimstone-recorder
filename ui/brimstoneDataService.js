function padDigits(len, num) {
    return num.toString().padStart(len, '0');
  }
  
  /** @param {Date} the date*/
  function formatDate(date) {
    return (
      [
        date.getFullYear(),
        padDigits(2, date.getMonth() + 1),
        padDigits(2, date.getDate()),
      ].join('-') +
      'T' +
      [
        padDigits(2, date.getHours()),
        padDigits(2, date.getMinutes()),
        padDigits(2, date.getSeconds())
      ].join(':')
      + '.' + padDigits(3, date.getMilliseconds()) + 'Z'
    );
  }


export class Step {
    /** @type {number} database id of this step */
    id;

    /** @type {number} database id of the test this step is in */
    testRunId;

    /** @type {number} the 0-based index of the step within the test */
    index;

    /** @type {string} the step can be named for human read ability */
    name; 

    /** @type {number} the user perceived latency in milliseconds */
    userLatency;

    /** @type {number} the memory used before this step executes in MBs*/
    clientMemory;
}

export class Test {
    /** @type {number} database identifier */
    id;
    
    /** @type {string} name of the recording or playlist */
    name;

    /** @type {string} 'pass' or 'fail' */
    status;

    /** @type {string} message about fail */
    errorMessage;

    /** @type {Date} when the run started */
    startDate = 0;
    
    /** @type {Date} when the run ended */
    endDate = 0;

    /** @type {number} how many seconds in walltime the run took */
    get wallTime() {
        return this.endDate - this.startDate;
    }
    
    /** @type {number} how many seconds of user time the rnun took. Sum over all step latencies. */
    get userTime() {
        let t = 0;
        if(this.steps && this.steps.length) {
            for(let i=0; i < this.steps.length; ++i) {
                t += this.steps[i].userLatency;
            }
        }
        return t;
    }

    /** @type {Step[]} */
    steps = [];

    toJSON() {
        return {
            id: this.id,
    
            /** @type {string} name of the recording or playlist */
            name: this.name,
        
            /** @type {string} 'pass' or 'fail' */
            status: this.status,
        
            /** @type {string} message about fail */
            errorMessage: this.errorMessage,
        
            /** @type {Date} when the run started */
            startDate: formatDate(new Date(this.startDate)),
            
            /** @type {Date} when the run ended */
            endDate: formatDate(new Date(this.endDate)),
        
            /** @type {number} how many seconds in walltime the run took */
            wallTime: this.wallTime,

            /** @type {number} how many seconds of user time the run took. Sum over all step latencies. */
            userTime: this.userTime,

            /** @type {Step[]} */
            steps: this.steps
        }
    }
};