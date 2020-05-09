(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(global = global || self, factory(global.EXP = {}));
}(this, function (exports) { 'use strict';

	/* The base class that everything inherits from. 
		Each thing drawn to the screen is a tree. Domains, such as EXP.Area or EXP.Array are the root nodes,
		EXP.Transformation is currently the only intermediate node, and the leaf nodes are some form of Output such as
		EXP.LineOutput or EXP.PointOutput, or EXP.VectorOutput.

		All of these can be .add()ed to each other to form that tree, and this file defines how it works.
	*/

	class Node{
		constructor(){        
			this.children = [];
			this.parent = null;        
	    }
		add(thing){
			//chainable so you can a.add(b).add(c) to make a->b->c
			this.children.push(thing);
			thing.parent = this;
			if(thing._onAdd)thing._onAdd();
			return thing;
		}
		_onAdd(){}
		remove(thing){
			var index = this.children.indexOf( thing );
			if ( index !== - 1 ) {
				thing.parent = null;
				this.children.splice( index, 1 );
			}
			return this;
		}
	    getTopParent(){ //find the parent of the parent of the... until there's no more parents.
	        const MAX_CHAIN = 100;
	        let parentCount = 0;
			let root = this;
			while(root !== null && root.parent !== null && parentCount < MAX_CHAIN){
				root = root.parent;
	            parentCount+= 1;
			}
			if(parentCount >= MAX_CHAIN)throw new Error("Unable to find top-level parent!");
	        return root;
	    }
	    getDeepestChildren(){ //find all leaf nodes from this node
	        //this algorithm can probably be improved
	        if(this.children.length == 0)return [this];

	        let children = [];
	        for(let i=0;i<this.children.length;i++){
	            let childsChildren = this.children[i].getDeepestChildren();
	            for(let j=0;j<childsChildren.length;j++){
	                children.push(childsChildren[j]);
	            }
	        }
	        return children;
	    }
	    getClosestDomain(){
	        /* Find the DomainNode that this Node is being called from.
	        Traverse the chain of parents upwards until we find a DomainNode, at which point we return it.
	        This allows an output to resize an array to match a domainNode's numCallsPerActivation, for example.

	        Note that this returns the MOST RECENT DomainNode ancestor - it's assumed that domainnodes overwrite one another.
	        */
	        const MAX_CHAIN = 100;
	        let parentCount = 0;
			let root = this.parent; //start one level up in case this is a DomainNode already. we don't want that
			while(root !== null && root.parent !== null && !root.isDomainNode && parentCount < MAX_CHAIN){
				root = root.parent;
	            parentCount+= 1;
			}
			if(parentCount >= MAX_CHAIN)throw new Error("Unable to find parent!");
	        if(root === null || !root.isDomainNode)throw new Error("No DomainNode parent found!");
	        return root;
	    }

		onAfterActivation(){
			// do nothing
			//but call all children
			for(var i=0;i<this.children.length;i++){
				this.children[i].onAfterActivation();
			}
		}
	}

	class OutputNode extends Node{ //more of a java interface, really
		constructor(){super();}
		evaluateSelf(i, t, x, y, z){}
		onAfterActivation(){}
		_onAdd(){}
	}

	class DomainNode extends Node{ //A node that calls other functions over some range.
		constructor(){
	        super();
			this.itemDimensions = []; // array to store the number of times this is called per dimension.
	        this.numCallsPerActivation = null; // number of times any child node's evaluateSelf() is called
	    }
	    activate(t){}
	}
	DomainNode.prototype.isDomainNode = true;

	//test??
	class EXPArray extends DomainNode{
		constructor(options){
			super();
			/*var points = new EXP.Array({
			data: [[-10,10],
				[10,10]]
			})*/

			EXP.Utils.assertPropExists(options, "data"); // a multidimensional array. assumed to only contain one type: either numbers or arrays
			EXP.Utils.assertType(options.data, Array);

			//It's assumed an EXP.Array will only store things such as 0, [0], [0,0] or [0,0,0]. If an array type is stored, this.arrayTypeDimensions contains the .length of that array. Otherwise it's 0, because points are 0-dimensional.
			if(options.data[0].constructor === Number){
				this.arrayTypeDimensions = 0;
			}else if(options.data[0].constructor === Array){
				this.arrayTypeDimensions = options.data[0].length;
			}else{
				console.error("Data in an EXP.Array should be a number or an array of other things, not " + options.data[0].constructor);
			}


			EXP.Utils.assert(options.data[0].length != 0); //don't accept [[]], data needs to be something like [[1,2]].

			this.data = options.data;
			this.numItems = this.data.length;

			this.itemDimensions = [this.data.length]; // array to store the number of times this is called per dimension.

			//the number of times every child's expr is called
			this.numCallsPerActivation = this.itemDimensions.reduce((sum,y)=>sum*y);
		}
		activate(t){
			if(this.arrayTypeDimensions == 0){
				//numbers can't be spread using ... operator
				for(var i=0;i<this.data.length;i++){
					this._callAllChildren(i,t,this.data[i]);
				}
			}else{
				for(var i=0;i<this.data.length;i++){
					this._callAllChildren(i,t,...this.data[i]);
				}
			}

			this.onAfterActivation(); // call children if necessary
		}
		_callAllChildren(...coordinates){
			for(var i=0;i<this.children.length;i++){
				this.children[i].evaluateSelf(...coordinates);
			}
		}
		clone(){
			let clone = new EXP.Array({data: EXP.Utils.arrayCopy(this.data)});
			for(var i=0;i<this.children.length;i++){
				clone.add(this.children[i].clone());
			}
			return clone;
		}
	}

	function multiplyScalar(c, array){
		for(var i=0;i<array.length;i++){
			array[i] *= c;
		}
		return array
	}
	function vectorAdd(v1,v2){
	    let vec = clone(v1);
		for(var i=0;i<v1.length;i++){
			vec[i] += v2[i];
		}
		return vec
	}
	function lerpVectors(t, p1, p2){
		//assumed t in [0,1]
		return vectorAdd(multiplyScalar(t,clone(p1)),multiplyScalar(1-t,clone(p2)));
	}
	function clone(vec){
		var newArr = new Array(vec.length);
		for(var i=0;i<vec.length;i++){
			newArr[i] = vec[i];
		}
		return newArr
	}
	function multiplyMatrix(vec, matrix){
		//assert vec.length == numRows

		let numRows = matrix.length;
		let numCols = matrix[0].length;

		var output = new Array(numCols);
		for(var j=0;j<numCols;j++){
			output[j] = 0;
			for(var i=0;i<numRows;i++){
				output[j] += matrix[i][j] * vec[i];
			}
		}
		return output;
	}

	//hack
	let Math$1 = {clone: clone, lerpVectors: lerpVectors, vectorAdd: vectorAdd, multiplyScalar: multiplyScalar, multiplyMatrix: multiplyMatrix};

	class Utils{

		static isArray(x){
			return x.constructor === Array;
		}
		static arrayCopy(x){
			return x.slice();
		}
		static isFunction(x){
			return x.constructor === Function;
		}

		static assert(thing){
			//A function to check if something is true and halt otherwise in a callbackable way.
			if(!thing){
				console.error("ERROR! Assertion failed. See traceback for more.");
	            console.trace();
			}
		}

		static assertType(thing, type, errorMsg){
			//A function to check if something is true and halt otherwise in a callbackable way.
			if(!(thing.constructor === type)){
				if(errorMsg){
					console.error("ERROR! Something not of required type "+type.name+"! \n"+errorMsg+"\n See traceback for more.");
				}else{
					console.error("ERROR! Something not of required type "+type.name+"! See traceback for more.");
				}
	            console.trace();
			}
		}


		static assertPropExists(thing, name){
			if(!thing || !(name in thing)){
				console.error("ERROR! "+name+" not present in required property");
	            console.trace();
			}
		}
		
		static clone(vec){
			return clone(vec);
		}
	}

	class Area extends DomainNode{
		constructor(options){
			super();

			/*var axes = new EXP.Area({
			bounds: [[-10,10],
				[10,10]]
			numItems: 10; //optional. Alternately numItems can vary for each axis: numItems: [10,2]
			})*/


		
			Utils.assertPropExists(options, "bounds"); // a multidimensional array
			Utils.assertType(options.bounds, Array);
			Utils.assertType(options.bounds[0], Array, "For an Area, options.bounds must be a multidimensional array, even for one dimension!"); // it MUST be multidimensional
			this.numDimensions = options.bounds.length;

			Utils.assert(options.bounds[0].length != 0); //don't accept [[]], it needs to be [[1,2]].

			this.bounds = options.bounds;
			this.numItems = options.numItems || 16;

			this.itemDimensions = []; // array to store the number of times this is called per dimension.

			if(this.numItems.constructor === Number){
				for(var i=0;i<this.numDimensions;i++){
					this.itemDimensions.push(this.numItems);
				}
			}else if(this.numItems.constructor === Array){
				Utils.assert(options.numItems.length == options.bounds.length);
				for(var i=0;i<this.numDimensions;i++){
					this.itemDimensions.push(this.numItems[i]);
				}
			}

			//the number of times every child's expr is called
			this.numCallsPerActivation = this.itemDimensions.reduce((sum,y)=>sum*y);
		}
		activate(t){
			//Use this to evaluate expr() and update the result, cascade-style.
			//the number of bounds this object has will be the number of dimensions.
			//the expr()s are called with expr(i, ...[coordinates], t), 
			//	(where i is the index of the current evaluation = times expr() has been called this frame, t = absolute timestep (s)).
			//please call with a t value obtained from performance.now()/1000 or something like that

			//note the less-than-or-equal-to in these loops
			if(this.numDimensions == 1){
				for(var i=0;i<this.itemDimensions[0];i++){
					let c1 = this.bounds[0][0] + (this.bounds[0][1]-this.bounds[0][0])*(i/(this.itemDimensions[0]-1));
					let index = i;
					this._callAllChildren(index,t,c1,0,0,0);
				}
			}else if(this.numDimensions == 2){
				//this can be reduced into a fancy recursion technique over the first index of this.bounds, I know it
				for(var i=0;i<this.itemDimensions[0];i++){
					let c1 = this.bounds[0][0] + (this.bounds[0][1]-this.bounds[0][0])*(i/(this.itemDimensions[0]-1));
					for(var j=0;j<this.itemDimensions[1];j++){
						let c2 = this.bounds[1][0] + (this.bounds[1][1]-this.bounds[1][0])*(j/(this.itemDimensions[1]-1));
						let index = i*this.itemDimensions[1] + j;
						this._callAllChildren(index,t,c1,c2,0,0);
					}
				}
			}else if(this.numDimensions == 3){
				//this can be reduced into a fancy recursion technique over the first index of this.bounds, I know it
				for(var i=0;i<this.itemDimensions[0];i++){
					let c1 = this.bounds[0][0] + (this.bounds[0][1]-this.bounds[0][0])*(i/(this.itemDimensions[0]-1));
					for(var j=0;j<this.itemDimensions[1];j++){
						let c2 = this.bounds[1][0] + (this.bounds[1][1]-this.bounds[1][0])*(j/(this.itemDimensions[1]-1));
						for(var k=0;k<this.itemDimensions[2];k++){
							let c3 = this.bounds[2][0] + (this.bounds[2][1]-this.bounds[2][0])*(k/(this.itemDimensions[2]-1));
							let index = (i*this.itemDimensions[1] + j)*this.itemDimensions[2] + k;
							this._callAllChildren(index,t,c1,c2,c3,0);
						}
					}
				}
			}else{
				assert("TODO: Use a fancy recursion technique to loop over all indices!");
			}

			this.onAfterActivation(); // call children if necessary
		}
		_callAllChildren(...coordinates){
			for(var i=0;i<this.children.length;i++){
				this.children[i].evaluateSelf(...coordinates);
			}
		}
		clone(){
			let clone = new Area({bounds: Utils.arrayCopy(this.bounds), numItems: this.numItems});
			for(var i=0;i<this.children.length;i++){
				clone.add(this.children[i].clone());
				if(clone.children[i]._onAdd)clone.children[i]._onAdd(); // necessary now that the chain of adding has been established
			}
			return clone;
		}
	}

	//Usage: var y = new Transformation({expr: function(...a){console.log(...a)}});
	class Transformation extends Node{
		constructor(options){
			super();
		
			EXP.Utils.assertPropExists(options, "expr"); // a function that returns a multidimensional array
			EXP.Utils.assertType(options.expr, Function);

			this.expr = options.expr;
		}
		evaluateSelf(...coordinates){
			//evaluate this Transformation's _expr, and broadcast the result to all children.
			let result = this.expr(...coordinates);
			if(result.constructor !== Array)result = [result];

			for(var i=0;i<this.children.length;i++){
				this.children[i].evaluateSelf(coordinates[0],coordinates[1], ...result);
			}
		}
		clone(){
			let thisExpr = this.expr;
			let clone = new Transformation({expr: thisExpr.bind()});
			for(var i=0;i<this.children.length;i++){
				clone.add(this.children[i].clone());
			}
			return clone;
		}
		makeLink(){
	        //like a clone, but will use the same expr as this Transformation.
	        //useful if there's a specific function that needs to be used by a bunch of objects
			return new LinkedTransformation(this);
		}
	}

	class LinkedTransformation extends Node{
	    /*
	        Like an EXP.Transformation, but it uses an existing EXP.Transformation's expr(), so if the linked transformation updates, so does this one. It's like a pointer to a Transformation, but in object form. 
	    */
		constructor(transformationToLinkTo){
			super({});
			EXP.Utils.assertType(transformationToLinkTo, Transformation);
	        this.linkedTransformationNode = transformationToLinkTo;
		}
		evaluateSelf(...coordinates){
			let result = this.linkedTransformationNode.expr(...coordinates);
			if(result.constructor !== Array)result = [result];

			for(var i=0;i<this.children.length;i++){
				this.children[i].evaluateSelf(coordinates[0],coordinates[1], ...result);
			}
		}
		clone(){
			let clone = new LinkedTransformation(this.linkedTransformationNode);
			for(var i=0;i<this.children.length;i++){
				clone.add(this.children[i].clone());
			}
			return clone;
		}
		makeLink(){
			return new LinkedTransformation(this.linkedTransformationNode);
		}
	}

	class HistoryRecorder extends DomainNode{
		constructor(options){
			super();

	        /*
	            Class that records the last few values of the parent Transformation and makes them available for use as an extra dimension.
	            Usage:
	            var recorder = new HistoryRecorder({
	                memoryLength: 10 // how many past values to store?
	                recordFrameInterval: 15//How long to wait between each capture? Measured in frames, so 60 = 1 capture per second, 30 = 2 captures/second, etc.
	            });

	            example usage:
	            new Area({bounds: [[-5,5]]}).add(new Transformation({expr: (i,t,x) => [Math.sin(x),Math.cos(x)]})).add(new EXP.HistoryRecorder({memoryLength: 5}).add(new LineOutput({width: 5, color: 0xff0000}));

	            NOTE: It is assumed that any parent transformation outputs an array of numbers that is 4 or less in length.
	        */

			this.memoryLength = options.memoryLength === undefined ? 10 : options.memoryLength;
	        this.recordFrameInterval = options.recordFrameInterval === undefined ? 15 : options.recordFrameInterval; //set to 1 to record every frame.
	        this._outputDimensions = 4; //how many dimensions per point to store? (todo: autodetect this from parent's output)
			this.currentHistoryIndex=0;
	        this.frameRecordTimer = 0;
		}
		_onAdd(){
			//climb up parent hierarchy to find the Area
			let root = this.getClosestDomain();

			this.numCallsPerActivation = root.numCallsPerActivation * this.memoryLength;
			this.itemDimensions = root.itemDimensions.concat([this.memoryLength]);

	        this.buffer = new Float32Array(this.numCallsPerActivation * this._outputDimensions);
	    
	        //This is so that no surface/boundary will appear until history begins to be recorded. I'm so sorry.
	        //Todo: proper clip shader like mathbox does or something.
	        this.buffer.fill(NaN); 
		}
	    onAfterActivation(){
	        super.onAfterActivation();

	        //every so often, shift to the next buffer slot
	        this.frameRecordTimer += 1;
	        if(this.frameRecordTimer >= this.recordFrameInterval){
	            //reset frame record timer
	            this.frameRecordTimer = 0;
	            this.currentHistoryIndex = (this.currentHistoryIndex+1)%this.memoryLength;
	        }
	    }
		evaluateSelf(...coordinates){
			//evaluate this Transformation's _expr, and broadcast the result to all children.
			let i = coordinates[0];
			let t = coordinates[1];
	    
	        //step 1: save coordinates for this frame in buffer
	        if(coordinates.length > 2+this._outputDimensions){
	            //todo: make this update this._outputDimensions and reallocate more buffer space
	            throw new Error("EXP.HistoryRecorder is unable to record history of something that outputs in "+this._outputDimensions+" dimensions! Yet.");
	        }

	        let cyclicBufferIndex = (i*this.memoryLength+this.currentHistoryIndex)*this._outputDimensions;
	        for(var j=0;j<coordinates.length-2;j++){ 
	            this.buffer[cyclicBufferIndex+j] = coordinates[2+j];
	        }

	        //step 2:, call any children once per history item
	        for(var childNo=0;childNo<this.children.length;childNo++){
			    for(var j=0;j<this.memoryLength;j++){

	                //the +1 in (j + this.currentHistoryIndex + 1) is important; without it, a LineOutput will draw a line from the most recent value to the end of history
	                let cyclicHistoryValue = (j + this.currentHistoryIndex + 1) % this.memoryLength;
	                let cyclicBufferIndex = (i * this.memoryLength + cyclicHistoryValue)*this._outputDimensions;
	                let nonCyclicIndex = i * this.memoryLength + j;

			        //I'm torn on whether to add a final coordinate at the end so history can go off in a new direction.
	                //this.children[childNo].evaluateSelf(nonCyclicIndex,t,this.buffer[cyclicBufferIndex], cyclicHistoryValue);
	                this.children[childNo].evaluateSelf(
	                        nonCyclicIndex,t, //i,t
	                        ...this.buffer.slice(cyclicBufferIndex,cyclicBufferIndex+this._outputDimensions) //extract coordinates for this history value from buffer
	                );
	            }
	        }
		}
		clone(){
			let clone = new HistoryRecorder({memoryLength: this.memoryLength, recordFrameInterval: this.recordFrameInterval});
			for(var i=0;i<this.children.length;i++){
				clone.add(this.children[i].clone());
			}
			return clone;
		}
	}

	exports.threeEnvironment = null;

	function setThreeEnvironment(newEnv){
	    exports.threeEnvironment = newEnv;
	}
	function getThreeEnvironment(){
	    return exports.threeEnvironment;
	}

	let EPS = Number.EPSILON;

	class Animation{
		constructor(target, toValues, duration, staggerFraction){
			Utils.assertType(toValues, Object);

			this.toValues = toValues;
			this.target = target;	
			this.staggerFraction = staggerFraction === undefined ? 0 : staggerFraction; // time in ms between first element beginning the animation and last element beginning the animation. Should be less than duration.

			Utils.assert(this.staggerFraction >= 0 && this.staggerFraction < 1);

			this.fromValues = {};
			for(var property in this.toValues){
				Utils.assertPropExists(this.target, property);

				//copy property, making sure to store the correct 'this'
				if(Utils.isFunction(this.target[property])){
					this.fromValues[property] = this.target[property].bind(this.target);
				}else{
					this.fromValues[property] = this.target[property];
				}
			}


			this.duration = duration === undefined ? 1 : duration; //in s
			this.elapsedTime = 0;

	        this.prevTrueTime = 0;


			if(target.constructor === Transformation){
				//find out how many objects are passing through this transformation
				let root = target;
				while(root.parent !== null){
					root = root.parent;
				}
				this.targetNumCallsPerActivation = root.numCallsPerActivation;
			}else{
				if(this.staggerFraction != 0){
					console.error("staggerFraction can only be used when TransitionTo's target is an EXP.Transformation!");
				}
			}

			//begin
			this._updateCallback = this.update.bind(this);
			exports.threeEnvironment.on("update",this._updateCallback);
		}
		update(time){
			this.elapsedTime += time.realtimeDelta;	

			let percentage = this.elapsedTime/this.duration;

			//interpolate values
			for(let property in this.toValues){
				this.interpolate(percentage, property, this.fromValues[property],this.toValues[property]);
			}

			if(this.elapsedTime >= this.duration){
				this.end();
			}
		}
		interpolate(percentage, propertyName, fromValue, toValue){
			const numObjects = this.targetNumCallsPerActivation;
			if(typeof(toValue) === "number" && typeof(fromValue) === "number"){
				let t = this.interpolationFunction(percentage);
				this.target[propertyName] = t*toValue + (1-t)*fromValue;
				return;
			}else if(Utils.isFunction(toValue) && Utils.isFunction(fromValue)){
				//if staggerFraction != 0, it's the amount of time between the first point's start time and the last point's start time.
				//ASSUMPTION: the first variable of this function is i, and it's assumed i is zero-indexed.

				//encapsulate percentage
				this.target[propertyName] = (function(...coords){
	                const i = coords[0];
					let lerpFactor = percentage;

	                //fancy staggering math, if we know how many objects are flowing through this transformation at once
	                if(this.targetNumCallsPerActivation !== undefined){
	                    lerpFactor = percentage/(1-this.staggerFraction+EPS) - i*this.staggerFraction/this.targetNumCallsPerActivation;
	                }
					//let percent = Math.min(Math.max(percentage - i/this.targetNumCallsPerActivation   ,1),0);

					let t = this.interpolationFunction(Math.max(Math.min(lerpFactor,1),0));
					return lerpVectors(t,toValue(...coords),fromValue(...coords))
				}).bind(this);
				return;
			}else if(toValue.constructor === THREE.Color && fromValue.constructor === THREE.Color){
	            let t = this.interpolationFunction(percentage);
	            let color = fromValue.clone();
	            this.target[propertyName] = color.lerp(toValue, t);
	        }else if(typeof(toValue) === "boolean" && typeof(fromValue) === "boolean"){
	            let t = this.interpolationFunction(percentage);
	            this.target[propertyName] = t > 0.5 ? toValue : fromValue;
	        }else{
				console.error("Animation class cannot yet handle transitioning between things that aren't numbers or functions!");
			}

		}
		interpolationFunction(x){
			return this.cosineInterpolation(x);
		}
		cosineInterpolation(x){
			return (1-Math.cos(x*Math.PI))/2;
		}
		linearInterpolation(x){
			return x;
		}
		end(){
			for(var prop in this.toValues){
				this.target[prop] = this.toValues[prop];
			}
			exports.threeEnvironment.removeEventListener("update",this._updateCallback);
			//Todo: delete this
		}
	}

	//todo: put this into a Director class so that it can have an undo stack
	function TransitionTo(target, toValues, durationMS, staggerFraction){
		var animation = new Animation(target, toValues, durationMS === undefined ? undefined : durationMS/1000, staggerFraction);
	}

	var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

	function commonjsRequire () {
		throw new Error('Dynamic requires are not currently supported by rollup-plugin-commonjs');
	}

	function createCommonjsModule(fn, module) {
		return module = { exports: {} }, fn(module, module.exports), module.exports;
	}

	var tar = createCommonjsModule(function (module) {
	(function () {

		var lookup = [
				'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
				'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
				'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X',
				'Y', 'Z', 'a', 'b', 'c', 'd', 'e', 'f',
				'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n',
				'o', 'p', 'q', 'r', 's', 't', 'u', 'v',
				'w', 'x', 'y', 'z', '0', '1', '2', '3',
				'4', '5', '6', '7', '8', '9', '+', '/'
			];
		function clean(length) {
			var i, buffer = new Uint8Array(length);
			for (i = 0; i < length; i += 1) {
				buffer[i] = 0;
			}
			return buffer;
		}

		function extend(orig, length, addLength, multipleOf) {
			var newSize = length + addLength,
				buffer = clean((parseInt(newSize / multipleOf) + 1) * multipleOf);

			buffer.set(orig);

			return buffer;
		}

		function pad(num, bytes, base) {
			num = num.toString(base || 8);
			return "000000000000".substr(num.length + 12 - bytes) + num;
		}

		function stringToUint8 (input, out, offset) {
			var i, length;

			out = out || clean(input.length);

			offset = offset || 0;
			for (i = 0, length = input.length; i < length; i += 1) {
				out[offset] = input.charCodeAt(i);
				offset += 1;
			}

			return out;
		}

		function uint8ToBase64(uint8) {
			var i,
				extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
				output = "",
				temp, length;

			function tripletToBase64 (num) {
				return lookup[num >> 18 & 0x3F] + lookup[num >> 12 & 0x3F] + lookup[num >> 6 & 0x3F] + lookup[num & 0x3F];
			}
			// go through the array every three bytes, we'll deal with trailing stuff later
			for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
				temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2]);
				output += tripletToBase64(temp);
			}

			// this prevents an ERR_INVALID_URL in Chrome (Firefox okay)
			switch (output.length % 4) {
				case 1:
					output += '=';
					break;
				case 2:
					output += '==';
					break;
				default:
					break;
			}

			return output;
		}

		window.utils = {};
		window.utils.clean = clean;
		window.utils.pad = pad;
		window.utils.extend = extend;
		window.utils.stringToUint8 = stringToUint8;
		window.utils.uint8ToBase64 = uint8ToBase64;
	}());

	(function () {

	/*
	struct posix_header {             // byte offset
		char name[100];               //   0
		char mode[8];                 // 100
		char uid[8];                  // 108
		char gid[8];                  // 116
		char size[12];                // 124
		char mtime[12];               // 136
		char chksum[8];               // 148
		char typeflag;                // 156
		char linkname[100];           // 157
		char magic[6];                // 257
		char version[2];              // 263
		char uname[32];               // 265
		char gname[32];               // 297
		char devmajor[8];             // 329
		char devminor[8];             // 337
		char prefix[155];             // 345
	                                  // 500
	};
	*/

		var utils = window.utils,
			headerFormat;

		headerFormat = [
			{
				'field': 'fileName',
				'length': 100
			},
			{
				'field': 'fileMode',
				'length': 8
			},
			{
				'field': 'uid',
				'length': 8
			},
			{
				'field': 'gid',
				'length': 8
			},
			{
				'field': 'fileSize',
				'length': 12
			},
			{
				'field': 'mtime',
				'length': 12
			},
			{
				'field': 'checksum',
				'length': 8
			},
			{
				'field': 'type',
				'length': 1
			},
			{
				'field': 'linkName',
				'length': 100
			},
			{
				'field': 'ustar',
				'length': 8
			},
			{
				'field': 'owner',
				'length': 32
			},
			{
				'field': 'group',
				'length': 32
			},
			{
				'field': 'majorNumber',
				'length': 8
			},
			{
				'field': 'minorNumber',
				'length': 8
			},
			{
				'field': 'filenamePrefix',
				'length': 155
			},
			{
				'field': 'padding',
				'length': 12
			}
		];

		function formatHeader(data, cb) {
			var buffer = utils.clean(512),
				offset = 0;

			headerFormat.forEach(function (value) {
				var str = data[value.field] || "",
					i, length;

				for (i = 0, length = str.length; i < length; i += 1) {
					buffer[offset] = str.charCodeAt(i);
					offset += 1;
				}

				offset += value.length - i; // space it out with nulls
			});

			if (typeof cb === 'function') {
				return cb(buffer, offset);
			}
			return buffer;
		}

		window.header = {};
		window.header.structure = headerFormat;
		window.header.format = formatHeader;
	}());

	(function () {

		var header = window.header,
			utils = window.utils,
			recordSize = 512,
			blockSize;

		function Tar(recordsPerBlock) {
			this.written = 0;
			blockSize = (recordsPerBlock || 20) * recordSize;
			this.out = utils.clean(blockSize);
			this.blocks = [];
			this.length = 0;
		}

		Tar.prototype.append = function (filepath, input, opts, callback) {
			var data,
				checksum,
				mode,
				mtime,
				uid,
				gid,
				headerArr;

			if (typeof input === 'string') {
				input = utils.stringToUint8(input);
			} else if (input.constructor !== Uint8Array.prototype.constructor) {
				throw 'Invalid input type. You gave me: ' + input.constructor.toString().match(/function\s*([$A-Za-z_][0-9A-Za-z_]*)\s*\(/)[1];
			}

			if (typeof opts === 'function') {
				callback = opts;
				opts = {};
			}

			opts = opts || {};

			mode = opts.mode || parseInt('777', 8) & 0xfff;
			mtime = opts.mtime || Math.floor(+new Date() / 1000);
			uid = opts.uid || 0;
			gid = opts.gid || 0;

			data = {
				fileName: filepath,
				fileMode: utils.pad(mode, 7),
				uid: utils.pad(uid, 7),
				gid: utils.pad(gid, 7),
				fileSize: utils.pad(input.length, 11),
				mtime: utils.pad(mtime, 11),
				checksum: '        ',
				type: '0', // just a file
				ustar: 'ustar  ',
				owner: opts.owner || '',
				group: opts.group || ''
			};

			// calculate the checksum
			checksum = 0;
			Object.keys(data).forEach(function (key) {
				var i, value = data[key], length;

				for (i = 0, length = value.length; i < length; i += 1) {
					checksum += value.charCodeAt(i);
				}
			});

			data.checksum = utils.pad(checksum, 6) + "\u0000 ";

			headerArr = header.format(data);

			var headerLength = Math.ceil( headerArr.length / recordSize ) * recordSize;
			var inputLength = Math.ceil( input.length / recordSize ) * recordSize;

			this.blocks.push( { header: headerArr, input: input, headerLength: headerLength, inputLength: inputLength } );

		};

		Tar.prototype.save = function() {

			var buffers = [];
			var chunks = [];
			var length = 0;
			var max = Math.pow( 2, 20 );

			var chunk = [];
			this.blocks.forEach( function( b ) {
				if( length + b.headerLength + b.inputLength > max ) {
					chunks.push( { blocks: chunk, length: length } );
					chunk = [];
					length = 0;
				}
				chunk.push( b );
				length += b.headerLength + b.inputLength;
			} );
			chunks.push( { blocks: chunk, length: length } );

			chunks.forEach( function( c ) {

				var buffer = new Uint8Array( c.length );
				var written = 0;
				c.blocks.forEach( function( b ) {
					buffer.set( b.header, written );
					written += b.headerLength;
					buffer.set( b.input, written );
					written += b.inputLength;
				} );
				buffers.push( buffer );

			} );

			buffers.push( new Uint8Array( 2 * recordSize ) );

			return new Blob( buffers, { type: 'octet/stream' } );

		};

		Tar.prototype.clear = function () {
			this.written = 0;
			this.out = utils.clean(blockSize);
		};

	  {
	    module.exports = Tar;
	  }
	}());
	});

	var download_1 = createCommonjsModule(function (module) {
	//download.js v3.0, by dandavis; 2008-2014. [CCBY2] see http://danml.com/download.html for tests/usage
	// v1 landed a FF+Chrome compat way of downloading strings to local un-named files, upgraded to use a hidden frame and optional mime
	// v2 added named files via a[download], msSaveBlob, IE (10+) support, and window.URL support for larger+faster saves than dataURLs
	// v3 added dataURL and Blob Input, bind-toggle arity, and legacy dataURL fallback was improved with force-download mime and base64 support

	// data can be a string, Blob, File, or dataURL




	function download(data, strFileName, strMimeType) {

		var self = window, // this script is only for browsers anyway...
			u = "application/octet-stream", // this default mime also triggers iframe downloads
			m = strMimeType || u,
			x = data,
			D = document,
			a = D.createElement("a"),
			z = function(a){return String(a);},


			B = self.Blob || self.MozBlob || self.WebKitBlob || z,
			BB = self.MSBlobBuilder || self.WebKitBlobBuilder || self.BlobBuilder,
			fn = strFileName || "download",
			blob,
			b,
			fr;

		//if(typeof B.bind === 'function' ){ B=B.bind(self); }

		if(String(this)==="true"){ //reverse arguments, allowing download.bind(true, "text/xml", "export.xml") to act as a callback
			x=[x, m];
			m=x[0];
			x=x[1];
		}



		//go ahead and download dataURLs right away
		if(String(x).match(/^data\:[\w+\-]+\/[\w+\-]+[,;]/)){
			return navigator.msSaveBlob ?  // IE10 can't do a[download], only Blobs:
				navigator.msSaveBlob(d2b(x), fn) :
				saver(x) ; // everyone else can save dataURLs un-processed
		}//end if dataURL passed?

		try{

			blob = x instanceof B ?
				x :
				new B([x], {type: m}) ;
		}catch(y){
			if(BB){
				b = new BB();
				b.append([x]);
				blob = b.getBlob(m); // the blob
			}

		}



		function d2b(u) {
			var p= u.split(/[:;,]/),
			t= p[1],
			dec= p[2] == "base64" ? atob : decodeURIComponent,
			bin= dec(p.pop()),
			mx= bin.length,
			i= 0,
			uia= new Uint8Array(mx);

			for(i;i<mx;++i) uia[i]= bin.charCodeAt(i);

			return new B([uia], {type: t});
		 }

		function saver(url, winMode){


			if ('download' in a) { //html5 A[download]
				a.href = url;
				a.setAttribute("download", fn);
				a.innerHTML = "downloading...";
				a.style.display = 'none';
				D.body.appendChild(a);
				setTimeout(function() {
					a.click();
					D.body.removeChild(a);
					if(winMode===true){setTimeout(function(){ self.URL.revokeObjectURL(a.href);}, 250 );}
				}, 66);
				return true;
			}

			//do iframe dataURL download (old ch+FF):
			var f = D.createElement("iframe");
			D.body.appendChild(f);
			if(!winMode){ // force a mime that will download:
				url="data:"+url.replace(/^data:([\w\/\-\+]+)/, u);
			}


			f.src = url;
			setTimeout(function(){ D.body.removeChild(f); }, 333);

		}//end saver


		if (navigator.msSaveBlob) { // IE10+ : (has Blob, but not a[download] or URL)
			return navigator.msSaveBlob(blob, fn);
		}

		if(self.URL){ // simple fast and modern way using Blob and URL:
			saver(self.URL.createObjectURL(blob), true);
		}else{
			// handle non-Blob()+non-URL browsers:
			if(typeof blob === "string" || blob.constructor===z ){
				try{
					return saver( "data:" +  m   + ";base64,"  +  self.btoa(blob)  );
				}catch(y){
					return saver( "data:" +  m   + "," + encodeURIComponent(blob)  );
				}
			}

			// Blob but not URL:
			fr=new FileReader();
			fr.onload=function(e){
				saver(this.result);
			};
			fr.readAsDataURL(blob);
		}
		return true;
	} /* end download() */

	{
	  module.exports = download;
	}
	});

	var gif = createCommonjsModule(function (module, exports) {
	// gif.js 0.2.0 - https://github.com/jnordberg/gif.js
	(function(f){{module.exports=f();}})(function(){return function(){function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof commonjsRequire=="function"&&commonjsRequire;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r);}return n[o].exports}var i=typeof commonjsRequire=="function"&&commonjsRequire;for(var o=0;o<r.length;o++)s(r[o]);return s}return e}()({1:[function(require,module,exports){function EventEmitter(){this._events=this._events||{};this._maxListeners=this._maxListeners||undefined;}module.exports=EventEmitter;EventEmitter.EventEmitter=EventEmitter;EventEmitter.prototype._events=undefined;EventEmitter.prototype._maxListeners=undefined;EventEmitter.defaultMaxListeners=10;EventEmitter.prototype.setMaxListeners=function(n){if(!isNumber(n)||n<0||isNaN(n))throw TypeError("n must be a positive number");this._maxListeners=n;return this};EventEmitter.prototype.emit=function(type){var er,handler,len,args,i,listeners;if(!this._events)this._events={};if(type==="error"){if(!this._events.error||isObject(this._events.error)&&!this._events.error.length){er=arguments[1];if(er instanceof Error){throw er}else{var err=new Error('Uncaught, unspecified "error" event. ('+er+")");err.context=er;throw err}}}handler=this._events[type];if(isUndefined(handler))return false;if(isFunction(handler)){switch(arguments.length){case 1:handler.call(this);break;case 2:handler.call(this,arguments[1]);break;case 3:handler.call(this,arguments[1],arguments[2]);break;default:args=Array.prototype.slice.call(arguments,1);handler.apply(this,args);}}else if(isObject(handler)){args=Array.prototype.slice.call(arguments,1);listeners=handler.slice();len=listeners.length;for(i=0;i<len;i++)listeners[i].apply(this,args);}return true};EventEmitter.prototype.addListener=function(type,listener){var m;if(!isFunction(listener))throw TypeError("listener must be a function");if(!this._events)this._events={};if(this._events.newListener)this.emit("newListener",type,isFunction(listener.listener)?listener.listener:listener);if(!this._events[type])this._events[type]=listener;else if(isObject(this._events[type]))this._events[type].push(listener);else this._events[type]=[this._events[type],listener];if(isObject(this._events[type])&&!this._events[type].warned){if(!isUndefined(this._maxListeners)){m=this._maxListeners;}else{m=EventEmitter.defaultMaxListeners;}if(m&&m>0&&this._events[type].length>m){this._events[type].warned=true;console.error("(node) warning: possible EventEmitter memory "+"leak detected. %d listeners added. "+"Use emitter.setMaxListeners() to increase limit.",this._events[type].length);if(typeof console.trace==="function"){console.trace();}}}return this};EventEmitter.prototype.on=EventEmitter.prototype.addListener;EventEmitter.prototype.once=function(type,listener){if(!isFunction(listener))throw TypeError("listener must be a function");var fired=false;function g(){this.removeListener(type,g);if(!fired){fired=true;listener.apply(this,arguments);}}g.listener=listener;this.on(type,g);return this};EventEmitter.prototype.removeListener=function(type,listener){var list,position,length,i;if(!isFunction(listener))throw TypeError("listener must be a function");if(!this._events||!this._events[type])return this;list=this._events[type];length=list.length;position=-1;if(list===listener||isFunction(list.listener)&&list.listener===listener){delete this._events[type];if(this._events.removeListener)this.emit("removeListener",type,listener);}else if(isObject(list)){for(i=length;i-- >0;){if(list[i]===listener||list[i].listener&&list[i].listener===listener){position=i;break}}if(position<0)return this;if(list.length===1){list.length=0;delete this._events[type];}else{list.splice(position,1);}if(this._events.removeListener)this.emit("removeListener",type,listener);}return this};EventEmitter.prototype.removeAllListeners=function(type){var key,listeners;if(!this._events)return this;if(!this._events.removeListener){if(arguments.length===0)this._events={};else if(this._events[type])delete this._events[type];return this}if(arguments.length===0){for(key in this._events){if(key==="removeListener")continue;this.removeAllListeners(key);}this.removeAllListeners("removeListener");this._events={};return this}listeners=this._events[type];if(isFunction(listeners)){this.removeListener(type,listeners);}else if(listeners){while(listeners.length)this.removeListener(type,listeners[listeners.length-1]);}delete this._events[type];return this};EventEmitter.prototype.listeners=function(type){var ret;if(!this._events||!this._events[type])ret=[];else if(isFunction(this._events[type]))ret=[this._events[type]];else ret=this._events[type].slice();return ret};EventEmitter.prototype.listenerCount=function(type){if(this._events){var evlistener=this._events[type];if(isFunction(evlistener))return 1;else if(evlistener)return evlistener.length}return 0};EventEmitter.listenerCount=function(emitter,type){return emitter.listenerCount(type)};function isFunction(arg){return typeof arg==="function"}function isNumber(arg){return typeof arg==="number"}function isObject(arg){return typeof arg==="object"&&arg!==null}function isUndefined(arg){return arg===void 0}},{}],2:[function(require,module,exports){var NeuQuant=require("./TypedNeuQuant.js");var LZWEncoder=require("./LZWEncoder.js");function ByteArray(){this.page=-1;this.pages=[];this.newPage();}ByteArray.pageSize=4096;ByteArray.charMap={};for(var i=0;i<256;i++)ByteArray.charMap[i]=String.fromCharCode(i);ByteArray.prototype.newPage=function(){this.pages[++this.page]=new Uint8Array(ByteArray.pageSize);this.cursor=0;};ByteArray.prototype.getData=function(){var rv="";for(var p=0;p<this.pages.length;p++){for(var i=0;i<ByteArray.pageSize;i++){rv+=ByteArray.charMap[this.pages[p][i]];}}return rv};ByteArray.prototype.writeByte=function(val){if(this.cursor>=ByteArray.pageSize)this.newPage();this.pages[this.page][this.cursor++]=val;};ByteArray.prototype.writeUTFBytes=function(string){for(var l=string.length,i=0;i<l;i++)this.writeByte(string.charCodeAt(i));};ByteArray.prototype.writeBytes=function(array,offset,length){for(var l=length||array.length,i=offset||0;i<l;i++)this.writeByte(array[i]);};function GIFEncoder(width,height){this.width=~~width;this.height=~~height;this.transparent=null;this.transIndex=0;this.repeat=-1;this.delay=0;this.image=null;this.pixels=null;this.indexedPixels=null;this.colorDepth=null;this.colorTab=null;this.neuQuant=null;this.usedEntry=new Array;this.palSize=7;this.dispose=-1;this.firstFrame=true;this.sample=10;this.dither=false;this.globalPalette=false;this.out=new ByteArray;}GIFEncoder.prototype.setDelay=function(milliseconds){this.delay=Math.round(milliseconds/10);};GIFEncoder.prototype.setFrameRate=function(fps){this.delay=Math.round(100/fps);};GIFEncoder.prototype.setDispose=function(disposalCode){if(disposalCode>=0)this.dispose=disposalCode;};GIFEncoder.prototype.setRepeat=function(repeat){this.repeat=repeat;};GIFEncoder.prototype.setTransparent=function(color){this.transparent=color;};GIFEncoder.prototype.addFrame=function(imageData){this.image=imageData;this.colorTab=this.globalPalette&&this.globalPalette.slice?this.globalPalette:null;this.getImagePixels();this.analyzePixels();if(this.globalPalette===true)this.globalPalette=this.colorTab;if(this.firstFrame){this.writeLSD();this.writePalette();if(this.repeat>=0){this.writeNetscapeExt();}}this.writeGraphicCtrlExt();this.writeImageDesc();if(!this.firstFrame&&!this.globalPalette)this.writePalette();this.writePixels();this.firstFrame=false;};GIFEncoder.prototype.finish=function(){this.out.writeByte(59);};GIFEncoder.prototype.setQuality=function(quality){if(quality<1)quality=1;this.sample=quality;};GIFEncoder.prototype.setDither=function(dither){if(dither===true)dither="FloydSteinberg";this.dither=dither;};GIFEncoder.prototype.setGlobalPalette=function(palette){this.globalPalette=palette;};GIFEncoder.prototype.getGlobalPalette=function(){return this.globalPalette&&this.globalPalette.slice&&this.globalPalette.slice(0)||this.globalPalette};GIFEncoder.prototype.writeHeader=function(){this.out.writeUTFBytes("GIF89a");};GIFEncoder.prototype.analyzePixels=function(){if(!this.colorTab){this.neuQuant=new NeuQuant(this.pixels,this.sample);this.neuQuant.buildColormap();this.colorTab=this.neuQuant.getColormap();}if(this.dither){this.ditherPixels(this.dither.replace("-serpentine",""),this.dither.match(/-serpentine/)!==null);}else{this.indexPixels();}this.pixels=null;this.colorDepth=8;this.palSize=7;if(this.transparent!==null){this.transIndex=this.findClosest(this.transparent,true);}};GIFEncoder.prototype.indexPixels=function(imgq){var nPix=this.pixels.length/3;this.indexedPixels=new Uint8Array(nPix);var k=0;for(var j=0;j<nPix;j++){var index=this.findClosestRGB(this.pixels[k++]&255,this.pixels[k++]&255,this.pixels[k++]&255);this.usedEntry[index]=true;this.indexedPixels[j]=index;}};GIFEncoder.prototype.ditherPixels=function(kernel,serpentine){var kernels={FalseFloydSteinberg:[[3/8,1,0],[3/8,0,1],[2/8,1,1]],FloydSteinberg:[[7/16,1,0],[3/16,-1,1],[5/16,0,1],[1/16,1,1]],Stucki:[[8/42,1,0],[4/42,2,0],[2/42,-2,1],[4/42,-1,1],[8/42,0,1],[4/42,1,1],[2/42,2,1],[1/42,-2,2],[2/42,-1,2],[4/42,0,2],[2/42,1,2],[1/42,2,2]],Atkinson:[[1/8,1,0],[1/8,2,0],[1/8,-1,1],[1/8,0,1],[1/8,1,1],[1/8,0,2]]};if(!kernel||!kernels[kernel]){throw"Unknown dithering kernel: "+kernel}var ds=kernels[kernel];var index=0,height=this.height,width=this.width,data=this.pixels;var direction=serpentine?-1:1;this.indexedPixels=new Uint8Array(this.pixels.length/3);for(var y=0;y<height;y++){if(serpentine)direction=direction*-1;for(var x=direction==1?0:width-1,xend=direction==1?width:0;x!==xend;x+=direction){index=y*width+x;var idx=index*3;var r1=data[idx];var g1=data[idx+1];var b1=data[idx+2];idx=this.findClosestRGB(r1,g1,b1);this.usedEntry[idx]=true;this.indexedPixels[index]=idx;idx*=3;var r2=this.colorTab[idx];var g2=this.colorTab[idx+1];var b2=this.colorTab[idx+2];var er=r1-r2;var eg=g1-g2;var eb=b1-b2;for(var i=direction==1?0:ds.length-1,end=direction==1?ds.length:0;i!==end;i+=direction){var x1=ds[i][1];var y1=ds[i][2];if(x1+x>=0&&x1+x<width&&y1+y>=0&&y1+y<height){var d=ds[i][0];idx=index+x1+y1*width;idx*=3;data[idx]=Math.max(0,Math.min(255,data[idx]+er*d));data[idx+1]=Math.max(0,Math.min(255,data[idx+1]+eg*d));data[idx+2]=Math.max(0,Math.min(255,data[idx+2]+eb*d));}}}}};GIFEncoder.prototype.findClosest=function(c,used){return this.findClosestRGB((c&16711680)>>16,(c&65280)>>8,c&255,used)};GIFEncoder.prototype.findClosestRGB=function(r,g,b,used){if(this.colorTab===null)return -1;if(this.neuQuant&&!used){return this.neuQuant.lookupRGB(r,g,b)}var minpos=0;var dmin=256*256*256;var len=this.colorTab.length;for(var i=0,index=0;i<len;index++){var dr=r-(this.colorTab[i++]&255);var dg=g-(this.colorTab[i++]&255);var db=b-(this.colorTab[i++]&255);var d=dr*dr+dg*dg+db*db;if((!used||this.usedEntry[index])&&d<dmin){dmin=d;minpos=index;}}return minpos};GIFEncoder.prototype.getImagePixels=function(){var w=this.width;var h=this.height;this.pixels=new Uint8Array(w*h*3);var data=this.image;var srcPos=0;var count=0;for(var i=0;i<h;i++){for(var j=0;j<w;j++){this.pixels[count++]=data[srcPos++];this.pixels[count++]=data[srcPos++];this.pixels[count++]=data[srcPos++];srcPos++;}}};GIFEncoder.prototype.writeGraphicCtrlExt=function(){this.out.writeByte(33);this.out.writeByte(249);this.out.writeByte(4);var transp,disp;if(this.transparent===null){transp=0;disp=0;}else{transp=1;disp=2;}if(this.dispose>=0){disp=this.dispose&7;}disp<<=2;this.out.writeByte(0|disp|0|transp);this.writeShort(this.delay);this.out.writeByte(this.transIndex);this.out.writeByte(0);};GIFEncoder.prototype.writeImageDesc=function(){this.out.writeByte(44);this.writeShort(0);this.writeShort(0);this.writeShort(this.width);this.writeShort(this.height);if(this.firstFrame||this.globalPalette){this.out.writeByte(0);}else{this.out.writeByte(128|0|0|0|this.palSize);}};GIFEncoder.prototype.writeLSD=function(){this.writeShort(this.width);this.writeShort(this.height);this.out.writeByte(128|112|0|this.palSize);this.out.writeByte(0);this.out.writeByte(0);};GIFEncoder.prototype.writeNetscapeExt=function(){this.out.writeByte(33);this.out.writeByte(255);this.out.writeByte(11);this.out.writeUTFBytes("NETSCAPE2.0");this.out.writeByte(3);this.out.writeByte(1);this.writeShort(this.repeat);this.out.writeByte(0);};GIFEncoder.prototype.writePalette=function(){this.out.writeBytes(this.colorTab);var n=3*256-this.colorTab.length;for(var i=0;i<n;i++)this.out.writeByte(0);};GIFEncoder.prototype.writeShort=function(pValue){this.out.writeByte(pValue&255);this.out.writeByte(pValue>>8&255);};GIFEncoder.prototype.writePixels=function(){var enc=new LZWEncoder(this.width,this.height,this.indexedPixels,this.colorDepth);enc.encode(this.out);};GIFEncoder.prototype.stream=function(){return this.out};module.exports=GIFEncoder;},{"./LZWEncoder.js":3,"./TypedNeuQuant.js":4}],3:[function(require,module,exports){var EOF=-1;var BITS=12;var HSIZE=5003;var masks=[0,1,3,7,15,31,63,127,255,511,1023,2047,4095,8191,16383,32767,65535];function LZWEncoder(width,height,pixels,colorDepth){var initCodeSize=Math.max(2,colorDepth);var accum=new Uint8Array(256);var htab=new Int32Array(HSIZE);var codetab=new Int32Array(HSIZE);var cur_accum,cur_bits=0;var a_count;var free_ent=0;var maxcode;var clear_flg=false;var g_init_bits,ClearCode,EOFCode;function char_out(c,outs){accum[a_count++]=c;if(a_count>=254)flush_char(outs);}function cl_block(outs){cl_hash(HSIZE);free_ent=ClearCode+2;clear_flg=true;output(ClearCode,outs);}function cl_hash(hsize){for(var i=0;i<hsize;++i)htab[i]=-1;}function compress(init_bits,outs){var fcode,c,i,ent,disp,hsize_reg,hshift;g_init_bits=init_bits;clear_flg=false;n_bits=g_init_bits;maxcode=MAXCODE(n_bits);ClearCode=1<<init_bits-1;EOFCode=ClearCode+1;free_ent=ClearCode+2;a_count=0;ent=nextPixel();hshift=0;for(fcode=HSIZE;fcode<65536;fcode*=2)++hshift;hshift=8-hshift;hsize_reg=HSIZE;cl_hash(hsize_reg);output(ClearCode,outs);outer_loop:while((c=nextPixel())!=EOF){fcode=(c<<BITS)+ent;i=c<<hshift^ent;if(htab[i]===fcode){ent=codetab[i];continue}else if(htab[i]>=0){disp=hsize_reg-i;if(i===0)disp=1;do{if((i-=disp)<0)i+=hsize_reg;if(htab[i]===fcode){ent=codetab[i];continue outer_loop}}while(htab[i]>=0)}output(ent,outs);ent=c;if(free_ent<1<<BITS){codetab[i]=free_ent++;htab[i]=fcode;}else{cl_block(outs);}}output(ent,outs);output(EOFCode,outs);}function encode(outs){outs.writeByte(initCodeSize);remaining=width*height;curPixel=0;compress(initCodeSize+1,outs);outs.writeByte(0);}function flush_char(outs){if(a_count>0){outs.writeByte(a_count);outs.writeBytes(accum,0,a_count);a_count=0;}}function MAXCODE(n_bits){return (1<<n_bits)-1}function nextPixel(){if(remaining===0)return EOF;--remaining;var pix=pixels[curPixel++];return pix&255}function output(code,outs){cur_accum&=masks[cur_bits];if(cur_bits>0)cur_accum|=code<<cur_bits;else cur_accum=code;cur_bits+=n_bits;while(cur_bits>=8){char_out(cur_accum&255,outs);cur_accum>>=8;cur_bits-=8;}if(free_ent>maxcode||clear_flg){if(clear_flg){maxcode=MAXCODE(n_bits=g_init_bits);clear_flg=false;}else{++n_bits;if(n_bits==BITS)maxcode=1<<BITS;else maxcode=MAXCODE(n_bits);}}if(code==EOFCode){while(cur_bits>0){char_out(cur_accum&255,outs);cur_accum>>=8;cur_bits-=8;}flush_char(outs);}}this.encode=encode;}module.exports=LZWEncoder;},{}],4:[function(require,module,exports){var ncycles=100;var netsize=256;var maxnetpos=netsize-1;var netbiasshift=4;var intbiasshift=16;var intbias=1<<intbiasshift;var gammashift=10;var betashift=10;var beta=intbias>>betashift;var betagamma=intbias<<gammashift-betashift;var initrad=netsize>>3;var radiusbiasshift=6;var radiusbias=1<<radiusbiasshift;var initradius=initrad*radiusbias;var radiusdec=30;var alphabiasshift=10;var initalpha=1<<alphabiasshift;var radbiasshift=8;var radbias=1<<radbiasshift;var alpharadbshift=alphabiasshift+radbiasshift;var alpharadbias=1<<alpharadbshift;var prime1=499;var prime2=491;var prime3=487;var prime4=503;var minpicturebytes=3*prime4;function NeuQuant(pixels,samplefac){var network;var netindex;var bias;var freq;var radpower;function init(){network=[];netindex=new Int32Array(256);bias=new Int32Array(netsize);freq=new Int32Array(netsize);radpower=new Int32Array(netsize>>3);var i,v;for(i=0;i<netsize;i++){v=(i<<netbiasshift+8)/netsize;network[i]=new Float64Array([v,v,v,0]);freq[i]=intbias/netsize;bias[i]=0;}}function unbiasnet(){for(var i=0;i<netsize;i++){network[i][0]>>=netbiasshift;network[i][1]>>=netbiasshift;network[i][2]>>=netbiasshift;network[i][3]=i;}}function altersingle(alpha,i,b,g,r){network[i][0]-=alpha*(network[i][0]-b)/initalpha;network[i][1]-=alpha*(network[i][1]-g)/initalpha;network[i][2]-=alpha*(network[i][2]-r)/initalpha;}function alterneigh(radius,i,b,g,r){var lo=Math.abs(i-radius);var hi=Math.min(i+radius,netsize);var j=i+1;var k=i-1;var m=1;var p,a;while(j<hi||k>lo){a=radpower[m++];if(j<hi){p=network[j++];p[0]-=a*(p[0]-b)/alpharadbias;p[1]-=a*(p[1]-g)/alpharadbias;p[2]-=a*(p[2]-r)/alpharadbias;}if(k>lo){p=network[k--];p[0]-=a*(p[0]-b)/alpharadbias;p[1]-=a*(p[1]-g)/alpharadbias;p[2]-=a*(p[2]-r)/alpharadbias;}}}function contest(b,g,r){var bestd=~(1<<31);var bestbiasd=bestd;var bestpos=-1;var bestbiaspos=bestpos;var i,n,dist,biasdist,betafreq;for(i=0;i<netsize;i++){n=network[i];dist=Math.abs(n[0]-b)+Math.abs(n[1]-g)+Math.abs(n[2]-r);if(dist<bestd){bestd=dist;bestpos=i;}biasdist=dist-(bias[i]>>intbiasshift-netbiasshift);if(biasdist<bestbiasd){bestbiasd=biasdist;bestbiaspos=i;}betafreq=freq[i]>>betashift;freq[i]-=betafreq;bias[i]+=betafreq<<gammashift;}freq[bestpos]+=beta;bias[bestpos]-=betagamma;return bestbiaspos}function inxbuild(){var i,j,p,q,smallpos,smallval,previouscol=0,startpos=0;for(i=0;i<netsize;i++){p=network[i];smallpos=i;smallval=p[1];for(j=i+1;j<netsize;j++){q=network[j];if(q[1]<smallval){smallpos=j;smallval=q[1];}}q=network[smallpos];if(i!=smallpos){j=q[0];q[0]=p[0];p[0]=j;j=q[1];q[1]=p[1];p[1]=j;j=q[2];q[2]=p[2];p[2]=j;j=q[3];q[3]=p[3];p[3]=j;}if(smallval!=previouscol){netindex[previouscol]=startpos+i>>1;for(j=previouscol+1;j<smallval;j++)netindex[j]=i;previouscol=smallval;startpos=i;}}netindex[previouscol]=startpos+maxnetpos>>1;for(j=previouscol+1;j<256;j++)netindex[j]=maxnetpos;}function inxsearch(b,g,r){var a,p,dist;var bestd=1e3;var best=-1;var i=netindex[g];var j=i-1;while(i<netsize||j>=0){if(i<netsize){p=network[i];dist=p[1]-g;if(dist>=bestd)i=netsize;else{i++;if(dist<0)dist=-dist;a=p[0]-b;if(a<0)a=-a;dist+=a;if(dist<bestd){a=p[2]-r;if(a<0)a=-a;dist+=a;if(dist<bestd){bestd=dist;best=p[3];}}}}if(j>=0){p=network[j];dist=g-p[1];if(dist>=bestd)j=-1;else{j--;if(dist<0)dist=-dist;a=p[0]-b;if(a<0)a=-a;dist+=a;if(dist<bestd){a=p[2]-r;if(a<0)a=-a;dist+=a;if(dist<bestd){bestd=dist;best=p[3];}}}}}return best}function learn(){var i;var lengthcount=pixels.length;var alphadec=30+(samplefac-1)/3;var samplepixels=lengthcount/(3*samplefac);var delta=~~(samplepixels/ncycles);var alpha=initalpha;var radius=initradius;var rad=radius>>radiusbiasshift;if(rad<=1)rad=0;for(i=0;i<rad;i++)radpower[i]=alpha*((rad*rad-i*i)*radbias/(rad*rad));var step;if(lengthcount<minpicturebytes){samplefac=1;step=3;}else if(lengthcount%prime1!==0){step=3*prime1;}else if(lengthcount%prime2!==0){step=3*prime2;}else if(lengthcount%prime3!==0){step=3*prime3;}else{step=3*prime4;}var b,g,r,j;var pix=0;i=0;while(i<samplepixels){b=(pixels[pix]&255)<<netbiasshift;g=(pixels[pix+1]&255)<<netbiasshift;r=(pixels[pix+2]&255)<<netbiasshift;j=contest(b,g,r);altersingle(alpha,j,b,g,r);if(rad!==0)alterneigh(rad,j,b,g,r);pix+=step;if(pix>=lengthcount)pix-=lengthcount;i++;if(delta===0)delta=1;if(i%delta===0){alpha-=alpha/alphadec;radius-=radius/radiusdec;rad=radius>>radiusbiasshift;if(rad<=1)rad=0;for(j=0;j<rad;j++)radpower[j]=alpha*((rad*rad-j*j)*radbias/(rad*rad));}}}function buildColormap(){init();learn();unbiasnet();inxbuild();}this.buildColormap=buildColormap;function getColormap(){var map=[];var index=[];for(var i=0;i<netsize;i++)index[network[i][3]]=i;var k=0;for(var l=0;l<netsize;l++){var j=index[l];map[k++]=network[j][0];map[k++]=network[j][1];map[k++]=network[j][2];}return map}this.getColormap=getColormap;this.lookupRGB=inxsearch;}module.exports=NeuQuant;},{}],5:[function(require,module,exports){var UA,browser,mode,platform,ua;ua=navigator.userAgent.toLowerCase();platform=navigator.platform.toLowerCase();UA=ua.match(/(opera|ie|firefox|chrome|version)[\s\/:]([\w\d\.]+)?.*?(safari|version[\s\/:]([\w\d\.]+)|$)/)||[null,"unknown",0];mode=UA[1]==="ie"&&document.documentMode;browser={name:UA[1]==="version"?UA[3]:UA[1],version:mode||parseFloat(UA[1]==="opera"&&UA[4]?UA[4]:UA[2]),platform:{name:ua.match(/ip(?:ad|od|hone)/)?"ios":(ua.match(/(?:webos|android)/)||platform.match(/mac|win|linux/)||["other"])[0]}};browser[browser.name]=true;browser[browser.name+parseInt(browser.version,10)]=true;browser.platform[browser.platform.name]=true;module.exports=browser;},{}],6:[function(require,module,exports){var EventEmitter,GIF,GIFEncoder,browser,gifWorker,extend=function(child,parent){for(var key in parent){if(hasProp.call(parent,key))child[key]=parent[key];}function ctor(){this.constructor=child;}ctor.prototype=parent.prototype;child.prototype=new ctor;child.__super__=parent.prototype;return child},hasProp={}.hasOwnProperty,indexOf=[].indexOf||function(item){for(var i=0,l=this.length;i<l;i++){if(i in this&&this[i]===item)return i}return -1},slice=[].slice;EventEmitter=require("events").EventEmitter;browser=require("./browser.coffee");GIFEncoder=require("./GIFEncoder.js");gifWorker=require("./gif.worker.coffee");module.exports=GIF=function(superClass){var defaults,frameDefaults;extend(GIF,superClass);defaults={workerScript:"gif.worker.js",workers:2,repeat:0,background:"#fff",quality:10,width:null,height:null,transparent:null,debug:false,dither:false};frameDefaults={delay:500,copy:false,dispose:-1};function GIF(options){var base,key,value;this.running=false;this.options={};this.frames=[];this.freeWorkers=[];this.activeWorkers=[];this.setOptions(options);for(key in defaults){value=defaults[key];if((base=this.options)[key]==null){base[key]=value;}}}GIF.prototype.setOption=function(key,value){this.options[key]=value;if(this._canvas!=null&&(key==="width"||key==="height")){return this._canvas[key]=value}};GIF.prototype.setOptions=function(options){var key,results,value;results=[];for(key in options){if(!hasProp.call(options,key))continue;value=options[key];results.push(this.setOption(key,value));}return results};GIF.prototype.addFrame=function(image,options){var frame,key;if(options==null){options={};}frame={};frame.transparent=this.options.transparent;for(key in frameDefaults){frame[key]=options[key]||frameDefaults[key];}if(this.options.width==null){this.setOption("width",image.width);}if(this.options.height==null){this.setOption("height",image.height);}if(typeof ImageData!=="undefined"&&ImageData!==null&&image instanceof ImageData){frame.data=image.data;}else if(typeof CanvasRenderingContext2D!=="undefined"&&CanvasRenderingContext2D!==null&&image instanceof CanvasRenderingContext2D||typeof WebGLRenderingContext!=="undefined"&&WebGLRenderingContext!==null&&image instanceof WebGLRenderingContext){if(options.copy){frame.data=this.getContextData(image);}else{frame.context=image;}}else if(image.childNodes!=null){if(options.copy){frame.data=this.getImageData(image);}else{frame.image=image;}}else{throw new Error("Invalid image")}return this.frames.push(frame)};GIF.prototype.render=function(){var i,j,numWorkers,ref;if(this.running){throw new Error("Already running")}if(this.options.width==null||this.options.height==null){throw new Error("Width and height must be set prior to rendering")}this.running=true;this.nextFrame=0;this.finishedFrames=0;this.imageParts=function(){var j,ref,results;results=[];for(i=j=0,ref=this.frames.length;0<=ref?j<ref:j>ref;i=0<=ref?++j:--j){results.push(null);}return results}.call(this);numWorkers=this.spawnWorkers();if(this.options.globalPalette===true){this.renderNextFrame();}else{for(i=j=0,ref=numWorkers;0<=ref?j<ref:j>ref;i=0<=ref?++j:--j){this.renderNextFrame();}}this.emit("start");return this.emit("progress",0)};GIF.prototype.abort=function(){var worker;while(true){worker=this.activeWorkers.shift();if(worker==null){break}this.log("killing active worker");worker.terminate();}this.running=false;return this.emit("abort")};GIF.prototype.spawnWorkers=function(){var numWorkers,ref,results;numWorkers=Math.min(this.options.workers,this.frames.length);(function(){results=[];for(var j=ref=this.freeWorkers.length;ref<=numWorkers?j<numWorkers:j>numWorkers;ref<=numWorkers?j++:j--){results.push(j);}return results}).apply(this).forEach(function(_this){return function(i){var worker;_this.log("spawning worker "+i);worker=new Worker(_this.options.workerScript);worker.onmessage=function(event){_this.activeWorkers.splice(_this.activeWorkers.indexOf(worker),1);_this.freeWorkers.push(worker);return _this.frameFinished(event.data)};return _this.freeWorkers.push(worker)}}(this));return numWorkers};GIF.prototype.frameFinished=function(frame){var i,j,ref;this.log("frame "+frame.index+" finished - "+this.activeWorkers.length+" active");this.finishedFrames++;this.emit("progress",this.finishedFrames/this.frames.length);this.imageParts[frame.index]=frame;if(this.options.globalPalette===true){this.options.globalPalette=frame.globalPalette;this.log("global palette analyzed");if(this.frames.length>2){for(i=j=1,ref=this.freeWorkers.length;1<=ref?j<ref:j>ref;i=1<=ref?++j:--j){this.renderNextFrame();}}}if(indexOf.call(this.imageParts,null)>=0){return this.renderNextFrame()}else{return this.finishRendering()}};GIF.prototype.finishRendering=function(){var data,frame,i,image,j,k,l,len,len1,len2,len3,offset,page,ref,ref1,ref2;len=0;ref=this.imageParts;for(j=0,len1=ref.length;j<len1;j++){frame=ref[j];len+=(frame.data.length-1)*frame.pageSize+frame.cursor;}len+=frame.pageSize-frame.cursor;this.log("rendering finished - filesize "+Math.round(len/1e3)+"kb");data=new Uint8Array(len);offset=0;ref1=this.imageParts;for(k=0,len2=ref1.length;k<len2;k++){frame=ref1[k];ref2=frame.data;for(i=l=0,len3=ref2.length;l<len3;i=++l){page=ref2[i];data.set(page,offset);if(i===frame.data.length-1){offset+=frame.cursor;}else{offset+=frame.pageSize;}}}image=new Blob([data],{type:"image/gif"});return this.emit("finished",image,data)};GIF.prototype.renderNextFrame=function(){var frame,task,worker;if(this.freeWorkers.length===0){throw new Error("No free workers")}if(this.nextFrame>=this.frames.length){return}frame=this.frames[this.nextFrame++];worker=this.freeWorkers.shift();task=this.getTask(frame);this.log("starting frame "+(task.index+1)+" of "+this.frames.length);this.activeWorkers.push(worker);return worker.postMessage(task)};GIF.prototype.getContextData=function(ctx){return ctx.getImageData(0,0,this.options.width,this.options.height).data};GIF.prototype.getImageData=function(image){var ctx;if(this._canvas==null){this._canvas=document.createElement("canvas");this._canvas.width=this.options.width;this._canvas.height=this.options.height;}ctx=this._canvas.getContext("2d");ctx.setFill=this.options.background;ctx.fillRect(0,0,this.options.width,this.options.height);ctx.drawImage(image,0,0);return this.getContextData(ctx)};GIF.prototype.getTask=function(frame){var index,task;index=this.frames.indexOf(frame);task={index:index,last:index===this.frames.length-1,delay:frame.delay,dispose:frame.dispose,transparent:frame.transparent,width:this.options.width,height:this.options.height,quality:this.options.quality,dither:this.options.dither,globalPalette:this.options.globalPalette,repeat:this.options.repeat,canTransfer:browser.name==="chrome"};if(frame.data!=null){task.data=frame.data;}else if(frame.context!=null){task.data=this.getContextData(frame.context);}else if(frame.image!=null){task.data=this.getImageData(frame.image);}else{throw new Error("Invalid frame")}return task};GIF.prototype.log=function(){var args;args=1<=arguments.length?slice.call(arguments,0):[];if(!this.options.debug){return}return console.log.apply(console,args)};return GIF}(EventEmitter);},{"./GIFEncoder.js":2,"./browser.coffee":5,"./gif.worker.coffee":7,events:1}],7:[function(require,module,exports){var GIFEncoder,renderFrame;GIFEncoder=require("./GIFEncoder.js");renderFrame=function(frame){var encoder,page,stream,transfer;encoder=new GIFEncoder(frame.width,frame.height);if(frame.index===0){encoder.writeHeader();}else{encoder.firstFrame=false;}encoder.setTransparent(frame.transparent);encoder.setDispose(frame.dispose);encoder.setRepeat(frame.repeat);encoder.setDelay(frame.delay);encoder.setQuality(frame.quality);encoder.setDither(frame.dither);encoder.setGlobalPalette(frame.globalPalette);encoder.addFrame(frame.data);if(frame.last){encoder.finish();}if(frame.globalPalette===true){frame.globalPalette=encoder.getGlobalPalette();}stream=encoder.stream();frame.data=stream.pages;frame.cursor=stream.cursor;frame.pageSize=stream.constructor.pageSize;if(frame.canTransfer){transfer=function(){var i,len,ref,results;ref=frame.data;results=[];for(i=0,len=ref.length;i<len;i++){page=ref[i];results.push(page.buffer);}return results}();return self.postMessage(frame,transfer)}else{return self.postMessage(frame)}};self.onmessage=function(event){return renderFrame(event.data)};},{"./GIFEncoder.js":2}]},{},[6])(6)});

	});

	var CCapture = createCommonjsModule(function (module, exports) {
	(function() {

	{
	  var Tar = tar;
	  var download = download_1;
	  var GIF = gif;
	}

	var objectTypes = {
	'function': true,
	'object': true
	};

	function checkGlobal(value) {
	    return (value && value.Object === Object) ? value : null;
	  }

	/** Detect free variable `exports`. */
	var freeExports = (exports && !exports.nodeType)
	? exports
	: undefined;

	/** Detect free variable `module`. */
	var freeModule = (module && !module.nodeType)
	? module
	: undefined;

	/** Detect the popular CommonJS extension `module.exports`. */
	var moduleExports = (freeModule && freeModule.exports === freeExports)
	? freeExports
	: undefined;

	/** Detect free variable `global` from Node.js. */
	var freeGlobal = checkGlobal(freeExports && freeModule && typeof commonjsGlobal == 'object' && commonjsGlobal);

	/** Detect free variable `self`. */
	var freeSelf = checkGlobal(objectTypes[typeof self] && self);

	/** Detect free variable `window`. */
	var freeWindow = checkGlobal(objectTypes[typeof window] && window);

	/** Detect `this` as the global object. */
	var thisGlobal = checkGlobal(objectTypes[typeof this] && this);

	/**
	* Used as a reference to the global object.
	*
	* The `this` value is used if it's the global object to avoid Greasemonkey's
	* restricted `window` object, otherwise the `window` object is used.
	*/
	var root = freeGlobal ||
	((freeWindow !== (thisGlobal && thisGlobal.window)) && freeWindow) ||
	  freeSelf || thisGlobal || Function('return this')();

	if( !('gc' in window ) ) {
		window.gc = function(){};
	}

	if (!HTMLCanvasElement.prototype.toBlob) {
	 Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
	  value: function (callback, type, quality) {

	    var binStr = atob( this.toDataURL(type, quality).split(',')[1] ),
	        len = binStr.length,
	        arr = new Uint8Array(len);

	    for (var i=0; i<len; i++ ) {
	     arr[i] = binStr.charCodeAt(i);
	    }

	    callback( new Blob( [arr], {type: type || 'image/png'} ) );
	  }
	 });
	}

	// @license http://opensource.org/licenses/MIT
	// copyright Paul Irish 2015


	// Date.now() is supported everywhere except IE8. For IE8 we use the Date.now polyfill
	//   github.com/Financial-Times/polyfill-service/blob/master/polyfills/Date.now/polyfill.js
	// as Safari 6 doesn't have support for NavigationTiming, we use a Date.now() timestamp for relative values

	// if you want values similar to what you'd get with real perf.now, place this towards the head of the page
	// but in reality, you're just getting the delta between now() calls, so it's not terribly important where it's placed


	(function(){

	  if ("performance" in window == false) {
	      window.performance = {};
	  }

	  Date.now = (Date.now || function () {  // thanks IE8
		  return new Date().getTime();
	  });

	  if ("now" in window.performance == false){

	    var nowOffset = Date.now();

	    if (performance.timing && performance.timing.navigationStart){
	      nowOffset = performance.timing.navigationStart;
	    }

	    window.performance.now = function now(){
	      return Date.now() - nowOffset;
	    };
	  }

	})();


	function pad( n ) {
		return String("0000000" + n).slice(-7);
	}
	// https://developer.mozilla.org/en-US/Add-ons/Code_snippets/Timers

	var g_startTime = window.Date.now();

	function guid() {
		function s4() {
			return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
		}
		return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
	}

	function CCFrameEncoder( settings ) {

		var _handlers = {};

		this.settings = settings;

		this.on = function(event, handler) {

			_handlers[event] = handler;

		};

		this.emit = function(event) {

			var handler = _handlers[event];
			if (handler) {

				handler.apply(null, Array.prototype.slice.call(arguments, 1));

			}

		};

		this.filename = settings.name || guid();
		this.extension = '';
		this.mimeType = '';

	}

	CCFrameEncoder.prototype.start = function(){};
	CCFrameEncoder.prototype.stop = function(){};
	CCFrameEncoder.prototype.add = function(){};
	CCFrameEncoder.prototype.save = function(){};
	CCFrameEncoder.prototype.dispose = function(){};
	CCFrameEncoder.prototype.safeToProceed = function(){ return true; };
	CCFrameEncoder.prototype.step = function() { console.log( 'Step not set!' ); };

	function CCTarEncoder( settings ) {

		CCFrameEncoder.call( this, settings );

		this.extension = '.tar';
		this.mimeType = 'application/x-tar';
		this.fileExtension = '';

		this.tape = null;
		this.count = 0;

	}

	CCTarEncoder.prototype = Object.create( CCFrameEncoder.prototype );

	CCTarEncoder.prototype.start = function(){

		this.dispose();

	};

	CCTarEncoder.prototype.add = function( blob ) {

		var fileReader = new FileReader();
		fileReader.onload = function() {
			this.tape.append( pad( this.count ) + this.fileExtension, new Uint8Array( fileReader.result ) );

			//if( this.settings.autoSaveTime > 0 && ( this.frames.length / this.settings.framerate ) >= this.settings.autoSaveTime ) {

			this.count++;
			this.step();
		}.bind( this );
		fileReader.readAsArrayBuffer(blob);

	};

	CCTarEncoder.prototype.save = function( callback ) {

		callback( this.tape.save() );

	};

	CCTarEncoder.prototype.dispose = function() {

		this.tape = new Tar();
		this.count = 0;

	};

	function CCPNGEncoder( settings ) {

		CCTarEncoder.call( this, settings );

		this.type = 'image/png';
		this.fileExtension = '.png';

	}

	CCPNGEncoder.prototype = Object.create( CCTarEncoder.prototype );

	CCPNGEncoder.prototype.add = function( canvas ) {

		canvas.toBlob( function( blob ) {
			CCTarEncoder.prototype.add.call( this, blob );
		}.bind( this ), this.type );

	};

	function CCJPEGEncoder( settings ) {

		CCTarEncoder.call( this, settings );

		this.type = 'image/jpeg';
		this.fileExtension = '.jpg';
		this.quality = ( settings.quality / 100 ) || .8;

	}

	CCJPEGEncoder.prototype = Object.create( CCTarEncoder.prototype );

	CCJPEGEncoder.prototype.add = function( canvas ) {

		canvas.toBlob( function( blob ) {
			CCTarEncoder.prototype.add.call( this, blob );
		}.bind( this ), this.type, this.quality );

	};

	/*

		WebM Encoder

	*/

	function CCWebMEncoder( settings ) {

		var canvas = document.createElement( 'canvas' );
		if( canvas.toDataURL( 'image/webp' ).substr(5,10) !== 'image/webp' ){
			console.log( "WebP not supported - try another export format" );
		}

		CCFrameEncoder.call( this, settings );

		this.quality = ( settings.quality / 100 ) || .8;

		this.extension = '.webm';
		this.mimeType = 'video/webm';
		this.baseFilename = this.filename;

		this.frames = [];
		this.part = 1;

	  this.videoWriter = new WebMWriter({
	    quality: this.quality,
	    fileWriter: null,
	    fd: null,
	    frameRate: settings.framerate
	});


	}

	CCWebMEncoder.prototype = Object.create( CCFrameEncoder.prototype );

	CCWebMEncoder.prototype.start = function( canvas ) {

		this.dispose();

	};

	CCWebMEncoder.prototype.add = function( canvas ) {

	  this.videoWriter.addFrame(canvas);

		//this.frames.push( canvas.toDataURL('image/webp', this.quality) );

		if( this.settings.autoSaveTime > 0 && ( this.frames.length / this.settings.framerate ) >= this.settings.autoSaveTime ) {
			this.save( function( blob ) {
				this.filename = this.baseFilename + '-part-' + pad( this.part );
				download( blob, this.filename + this.extension, this.mimeType );
				this.dispose();
				this.part++;
				this.filename = this.baseFilename + '-part-' + pad( this.part );
				this.step();
			}.bind( this ) );
		} else {
			this.step();
		}

	};

	CCWebMEncoder.prototype.save = function( callback ) {

	//	if( !this.frames.length ) return;

	  this.videoWriter.complete().then(callback);

		/*var webm = Whammy.fromImageArray( this.frames, this.settings.framerate )
		var blob = new Blob( [ webm ], { type: "octet/stream" } );
		callback( blob );*/

	};

	CCWebMEncoder.prototype.dispose = function( canvas ) {

		this.frames = [];

	};

	function CCFFMpegServerEncoder( settings ) {

		CCFrameEncoder.call( this, settings );

		settings.quality = ( settings.quality / 100 ) || .8;

		this.encoder = new FFMpegServer.Video( settings );
	    this.encoder.on( 'process', function() {
	        this.emit( 'process' );
	    }.bind( this ) );
	    this.encoder.on('finished', function( url, size ) {
	        var cb = this.callback;
	        if ( cb ) {
	            this.callback = undefined;
	            cb( url, size );
	        }
	    }.bind( this ) );
	    this.encoder.on( 'progress', function( progress ) {
	        if ( this.settings.onProgress ) {
	            this.settings.onProgress( progress );
	        }
	    }.bind( this ) );
	    this.encoder.on( 'error', function( data ) {
	        alert(JSON.stringify(data, null, 2));
	    }.bind( this ) );

	}

	CCFFMpegServerEncoder.prototype = Object.create( CCFrameEncoder.prototype );

	CCFFMpegServerEncoder.prototype.start = function() {

		this.encoder.start( this.settings );

	};

	CCFFMpegServerEncoder.prototype.add = function( canvas ) {

		this.encoder.add( canvas );

	};

	CCFFMpegServerEncoder.prototype.save = function( callback ) {

	    this.callback = callback;
	    this.encoder.end();

	};

	CCFFMpegServerEncoder.prototype.safeToProceed = function() {
	    return this.encoder.safeToProceed();
	};

	/*
		HTMLCanvasElement.captureStream()
	*/

	function CCStreamEncoder( settings ) {

		CCFrameEncoder.call( this, settings );

		this.framerate = this.settings.framerate;
		this.type = 'video/webm';
		this.extension = '.webm';
		this.stream = null;
		this.mediaRecorder = null;
		this.chunks = [];

	}

	CCStreamEncoder.prototype = Object.create( CCFrameEncoder.prototype );

	CCStreamEncoder.prototype.add = function( canvas ) {

		if( !this.stream ) {
			this.stream = canvas.captureStream( this.framerate );
			this.mediaRecorder = new MediaRecorder( this.stream );
			this.mediaRecorder.start();

			this.mediaRecorder.ondataavailable = function(e) {
				this.chunks.push(e.data);
			}.bind( this );

		}
		this.step();

	};

	CCStreamEncoder.prototype.save = function( callback ) {

		this.mediaRecorder.onstop = function( e ) {
			var blob = new Blob( this.chunks, { 'type' : 'video/webm' });
			this.chunks = [];
			callback( blob );

		}.bind( this );

		this.mediaRecorder.stop();

	};

	/*function CCGIFEncoder( settings ) {

		CCFrameEncoder.call( this );

		settings.quality = settings.quality || 6;
		this.settings = settings;

		this.encoder = new GIFEncoder();
		this.encoder.setRepeat( 1 );
	  	this.encoder.setDelay( settings.step );
	  	this.encoder.setQuality( 6 );
	  	this.encoder.setTransparent( null );
	  	this.encoder.setSize( 150, 150 );

	  	this.canvas = document.createElement( 'canvas' );
	  	this.ctx = this.canvas.getContext( '2d' );

	}

	CCGIFEncoder.prototype = Object.create( CCFrameEncoder );

	CCGIFEncoder.prototype.start = function() {

		this.encoder.start();

	}

	CCGIFEncoder.prototype.add = function( canvas ) {

		this.canvas.width = canvas.width;
		this.canvas.height = canvas.height;
		this.ctx.drawImage( canvas, 0, 0 );
		this.encoder.addFrame( this.ctx );

		this.encoder.setSize( canvas.width, canvas.height );
		var readBuffer = new Uint8Array(canvas.width * canvas.height * 4);
		var context = canvas.getContext( 'webgl' );
		context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, readBuffer);
		this.encoder.addFrame( readBuffer, true );

	}

	CCGIFEncoder.prototype.stop = function() {

		this.encoder.finish();

	}

	CCGIFEncoder.prototype.save = function( callback ) {

		var binary_gif = this.encoder.stream().getData();

		var data_url = 'data:image/gif;base64,'+encode64(binary_gif);
		window.location = data_url;
		return;

		var blob = new Blob( [ binary_gif ], { type: "octet/stream" } );
		var url = window.URL.createObjectURL( blob );
		callback( url );

	}*/

	function CCGIFEncoder( settings ) {

		CCFrameEncoder.call( this, settings );

		settings.quality = 31 - ( ( settings.quality * 30 / 100 ) || 10 );
		settings.workers = settings.workers || 4;

		this.extension = '.gif';
		this.mimeType = 'image/gif';

	  	this.canvas = document.createElement( 'canvas' );
	  	this.ctx = this.canvas.getContext( '2d' );
	  	this.sizeSet = false;

	  	this.encoder = new GIF({
			workers: settings.workers,
			quality: settings.quality,
			workerScript: settings.workersPath + 'gif.worker.js'
		} );

	    this.encoder.on( 'progress', function( progress ) {
	        if ( this.settings.onProgress ) {
	            this.settings.onProgress( progress );
	        }
	    }.bind( this ) );

	    this.encoder.on('finished', function( blob ) {
	        var cb = this.callback;
	        if ( cb ) {
	            this.callback = undefined;
	            cb( blob );
	        }
	    }.bind( this ) );

	}

	CCGIFEncoder.prototype = Object.create( CCFrameEncoder.prototype );

	CCGIFEncoder.prototype.add = function( canvas ) {

		if( !this.sizeSet ) {
			this.encoder.setOption( 'width',canvas.width );
			this.encoder.setOption( 'height',canvas.height );
			this.sizeSet = true;
		}

		this.canvas.width = canvas.width;
		this.canvas.height = canvas.height;
		this.ctx.drawImage( canvas, 0, 0 );

		this.encoder.addFrame( this.ctx, { copy: true, delay: this.settings.step } );
		this.step();

		/*this.encoder.setSize( canvas.width, canvas.height );
		var readBuffer = new Uint8Array(canvas.width * canvas.height * 4);
		var context = canvas.getContext( 'webgl' );
		context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, readBuffer);
		this.encoder.addFrame( readBuffer, true );*/

	};

	CCGIFEncoder.prototype.save = function( callback ) {

	    this.callback = callback;

		this.encoder.render();

	};

	function CCapture( settings ) {

		var _settings = settings || {},
			_verbose,
			_display,
			_time,
			_startTime,
			_performanceTime,
			_performanceStartTime,
			_step,
	        _encoder,
			_timeouts = [],
			_intervals = [],
			_frameCount = 0,
			_intermediateFrameCount = 0,
			_requestAnimationFrameCallbacks = [],
			_capturing = false,
	        _handlers = {};

		_settings.framerate = _settings.framerate || 60;
		_settings.motionBlurFrames = 2 * ( _settings.motionBlurFrames || 1 );
		_verbose = _settings.verbose || false;
		_display = _settings.display || false;
		_settings.step = 1000.0 / _settings.framerate ;
		_settings.timeLimit = _settings.timeLimit || 0;
		_settings.frameLimit = _settings.frameLimit || 0;
		_settings.startTime = _settings.startTime || 0;

		var _timeDisplay = document.createElement( 'div' );
		_timeDisplay.style.position = 'absolute';
		_timeDisplay.style.left = _timeDisplay.style.top = 0;
		_timeDisplay.style.backgroundColor = 'black';
		_timeDisplay.style.fontFamily = 'monospace';
		_timeDisplay.style.fontSize = '11px';
		_timeDisplay.style.padding = '5px';
		_timeDisplay.style.color = 'red';
		_timeDisplay.style.zIndex = 100000;
		if( _settings.display ) document.body.appendChild( _timeDisplay );

		var canvasMotionBlur = document.createElement( 'canvas' );
		var ctxMotionBlur = canvasMotionBlur.getContext( '2d' );
		var bufferMotionBlur;
		var imageData;

		_log( 'Step is set to ' + _settings.step + 'ms' );

	    var _encoders = {
			gif: CCGIFEncoder,
			webm: CCWebMEncoder,
			ffmpegserver: CCFFMpegServerEncoder,
			png: CCPNGEncoder,
			jpg: CCJPEGEncoder,
			'webm-mediarecorder': CCStreamEncoder
	    };

	    var ctor = _encoders[ _settings.format ];
	    if ( !ctor ) {
			throw "Error: Incorrect or missing format: Valid formats are " + Object.keys(_encoders).join(", ");
	    }
	    _encoder = new ctor( _settings );
	    _encoder.step = _step;

		_encoder.on('process', _process);
	    _encoder.on('progress', _progress);

	    if ("performance" in window == false) {
	    	window.performance = {};
	    }

		Date.now = (Date.now || function () {  // thanks IE8
			return new Date().getTime();
		});

		if ("now" in window.performance == false){

			var nowOffset = Date.now();

			if (performance.timing && performance.timing.navigationStart){
				nowOffset = performance.timing.navigationStart;
			}

			window.performance.now = function now(){
				return Date.now() - nowOffset;
			};
		}

		var _oldSetTimeout = window.setTimeout,
			_oldSetInterval = window.setInterval,
		    	_oldClearInterval = window.clearInterval,
			_oldClearTimeout = window.clearTimeout,
			_oldRequestAnimationFrame = window.requestAnimationFrame,
			_oldNow = window.Date.now,
			_oldPerformanceNow = window.performance.now,
			_oldGetTime = window.Date.prototype.getTime;
		// Date.prototype._oldGetTime = Date.prototype.getTime;

		var media = [];

		function _init() {

			_log( 'Capturer start' );

			_startTime = window.Date.now();
			_time = _startTime + _settings.startTime;
			_performanceStartTime = window.performance.now();
			_performanceTime = _performanceStartTime + _settings.startTime;

			window.Date.prototype.getTime = function(){
				return _time;
			};
			window.Date.now = function() {
				return _time;
			};

			window.setTimeout = function( callback, time ) {
				var t = {
					callback: callback,
					time: time,
					triggerTime: _time + time
				};
				_timeouts.push( t );
				_log( 'Timeout set to ' + t.time );
	            return t;
			};
			window.clearTimeout = function( id ) {
				for( var j = 0; j < _timeouts.length; j++ ) {
					if( _timeouts[ j ] == id ) {
						_timeouts.splice( j, 1 );
						_log( 'Timeout cleared' );
						continue;
					}
				}
			};
			window.setInterval = function( callback, time ) {
				var t = {
					callback: callback,
					time: time,
					triggerTime: _time + time
				};
				_intervals.push( t );
				_log( 'Interval set to ' + t.time );
				return t;
			};
			window.clearInterval = function( id ) {
				_log( 'clear Interval' );
				return null;
			};
			window.requestAnimationFrame = function( callback ) {
				_requestAnimationFrameCallbacks.push( callback );
			};
			window.performance.now = function(){
				return _performanceTime;
			};

			function hookCurrentTime() {
				if( !this._hooked ) {
					this._hooked = true;
					this._hookedTime = this.currentTime || 0;
					this.pause();
					media.push( this );
				}
				return this._hookedTime + _settings.startTime;
			}
			try {
				Object.defineProperty( HTMLVideoElement.prototype, 'currentTime', { get: hookCurrentTime } );
				Object.defineProperty( HTMLAudioElement.prototype, 'currentTime', { get: hookCurrentTime } );
			} catch (err) {
				_log(err);
			}

		}

		function _start() {
			_init();
			_encoder.start();
			_capturing = true;
		}

		function _stop() {
			_capturing = false;
			_encoder.stop();
			_destroy();
		}

		function _call( fn, p ) {
			_oldSetTimeout( fn, 0, p );
		}

		function _step() {
			//_oldRequestAnimationFrame( _process );
			_call( _process );
		}

		function _destroy() {
			_log( 'Capturer stop' );
			window.setTimeout = _oldSetTimeout;
			window.setInterval = _oldSetInterval;
			window.clearInterval = _oldClearInterval;
			window.clearTimeout = _oldClearTimeout;
			window.requestAnimationFrame = _oldRequestAnimationFrame;
			window.Date.prototype.getTime = _oldGetTime;
			window.Date.now = _oldNow;
			window.performance.now = _oldPerformanceNow;
		}

		function _updateTime() {
			var seconds = _frameCount / _settings.framerate;
			if( ( _settings.frameLimit && _frameCount >= _settings.frameLimit ) || ( _settings.timeLimit && seconds >= _settings.timeLimit ) ) {
				_stop();
				_save();
			}
			var d = new Date( null );
			d.setSeconds( seconds );
			if( _settings.motionBlurFrames > 2 ) {
				_timeDisplay.textContent = 'CCapture ' + _settings.format + ' | ' + _frameCount + ' frames (' + _intermediateFrameCount + ' inter) | ' +  d.toISOString().substr( 11, 8 );
			} else {
				_timeDisplay.textContent = 'CCapture ' + _settings.format + ' | ' + _frameCount + ' frames | ' +  d.toISOString().substr( 11, 8 );
			}
		}

		function _checkFrame( canvas ) {

			if( canvasMotionBlur.width !== canvas.width || canvasMotionBlur.height !== canvas.height ) {
				canvasMotionBlur.width = canvas.width;
				canvasMotionBlur.height = canvas.height;
				bufferMotionBlur = new Uint16Array( canvasMotionBlur.height * canvasMotionBlur.width * 4 );
				ctxMotionBlur.fillStyle = '#0';
				ctxMotionBlur.fillRect( 0, 0, canvasMotionBlur.width, canvasMotionBlur.height );
			}

		}

		function _blendFrame( canvas ) {

			//_log( 'Intermediate Frame: ' + _intermediateFrameCount );

			ctxMotionBlur.drawImage( canvas, 0, 0 );
			imageData = ctxMotionBlur.getImageData( 0, 0, canvasMotionBlur.width, canvasMotionBlur.height );
			for( var j = 0; j < bufferMotionBlur.length; j+= 4 ) {
				bufferMotionBlur[ j ] += imageData.data[ j ];
				bufferMotionBlur[ j + 1 ] += imageData.data[ j + 1 ];
				bufferMotionBlur[ j + 2 ] += imageData.data[ j + 2 ];
			}
			_intermediateFrameCount++;

		}

		function _saveFrame(){

			var data = imageData.data;
			for( var j = 0; j < bufferMotionBlur.length; j+= 4 ) {
				data[ j ] = bufferMotionBlur[ j ] * 2 / _settings.motionBlurFrames;
				data[ j + 1 ] = bufferMotionBlur[ j + 1 ] * 2 / _settings.motionBlurFrames;
				data[ j + 2 ] = bufferMotionBlur[ j + 2 ] * 2 / _settings.motionBlurFrames;
			}
			ctxMotionBlur.putImageData( imageData, 0, 0 );
			_encoder.add( canvasMotionBlur );
			_frameCount++;
			_intermediateFrameCount = 0;
			_log( 'Full MB Frame! ' + _frameCount + ' ' +  _time );
			for( var j = 0; j < bufferMotionBlur.length; j+= 4 ) {
				bufferMotionBlur[ j ] = 0;
				bufferMotionBlur[ j + 1 ] = 0;
				bufferMotionBlur[ j + 2 ] = 0;
			}
			gc();

		}

		function _capture( canvas ) {

			if( _capturing ) {

				if( _settings.motionBlurFrames > 2 ) {

					_checkFrame( canvas );
					_blendFrame( canvas );

					if( _intermediateFrameCount >= .5 * _settings.motionBlurFrames ) {
						_saveFrame();
					} else {
						_step();
					}

				} else {
					_encoder.add( canvas );
					_frameCount++;
					_log( 'Full Frame! ' + _frameCount );
				}

			}

		}

		function _process() {

			var step = 1000 / _settings.framerate;
			var dt = ( _frameCount + _intermediateFrameCount / _settings.motionBlurFrames ) * step;

			_time = _startTime + dt;
			_performanceTime = _performanceStartTime + dt;

			media.forEach( function( v ) {
				v._hookedTime = dt / 1000;
			} );

			_updateTime();
			_log( 'Frame: ' + _frameCount + ' ' + _intermediateFrameCount );

			for( var j = 0; j < _timeouts.length; j++ ) {
				if( _time >= _timeouts[ j ].triggerTime ) {
					_call( _timeouts[ j ].callback );
					//console.log( 'timeout!' );
					_timeouts.splice( j, 1 );
					continue;
				}
			}

			for( var j = 0; j < _intervals.length; j++ ) {
				if( _time >= _intervals[ j ].triggerTime ) {
					_call( _intervals[ j ].callback );
					_intervals[ j ].triggerTime += _intervals[ j ].time;
					//console.log( 'interval!' );
					continue;
				}
			}

			_requestAnimationFrameCallbacks.forEach( function( cb ) {
	     		_call( cb, _time - g_startTime );
	        } );
	        _requestAnimationFrameCallbacks = [];

		}

		function _save( callback ) {

			if( !callback ) {
				callback = function( blob ) {
					download( blob, _encoder.filename + _encoder.extension, _encoder.mimeType );
					return false;
				};
			}
			_encoder.save( callback );

		}

		function _log( message ) {
			if( _verbose ) console.log( message );
		}

	    function _on( event, handler ) {

	        _handlers[event] = handler;

	    }

	    function _emit( event ) {

	        var handler = _handlers[event];
	        if ( handler ) {

	            handler.apply( null, Array.prototype.slice.call( arguments, 1 ) );

	        }

	    }

	    function _progress( progress ) {

	        _emit( 'progress', progress );

	    }

		return {
			start: _start,
			capture: _capture,
			stop: _stop,
			save: _save,
	        on: _on
		}
	}

	(freeWindow || freeSelf || {}).CCapture = CCapture;

	  // Some AMD build optimizers like r.js check for condition patterns like the following:
	  if (freeExports && freeModule) {
	    // Export for Node.js.
	    if (moduleExports) {
	    	(freeModule.exports = CCapture).CCapture = CCapture;
	    }
	    // Export for CommonJS support.
	    freeExports.CCapture = CCapture;
	}
	else {
	    // Export to the global object.
	    root.CCapture = CCapture;
	}

	}());
	});

	/**
	 * @author alteredq / http://alteredqualia.com/
	 * @author mr.doob / http://mrdoob.com/
	 */

	var Detector = {

		canvas: !! window.CanvasRenderingContext2D,
		webgl: ( function () {

			try {

				var canvas = document.createElement( 'canvas' ); return !! ( window.WebGLRenderingContext && ( canvas.getContext( 'webgl' ) || canvas.getContext( 'experimental-webgl' ) ) );

			} catch ( e ) {

				return false;

			}

		} )(),
		workers: !! window.Worker,
		fileapi: window.File && window.FileReader && window.FileList && window.Blob,

		getWebGLErrorMessage: function () {

			var element = document.createElement( 'div' );
			element.id = 'webgl-error-message';
			element.style.fontFamily = 'monospace';
			element.style.fontSize = '13px';
			element.style.fontWeight = 'normal';
			element.style.textAlign = 'center';
			element.style.background = '#fff';
			element.style.color = '#000';
			element.style.padding = '1.5em';
			element.style.zIndex = '999';
			element.style.width = '400px';
			element.style.margin = '5em auto 0';

			if ( ! this.webgl ) {

				element.innerHTML = window.WebGLRenderingContext ? [
					'Your graphics card does not seem to support <a href="http://khronos.org/webgl/wiki/Getting_a_WebGL_Implementation" style="color:#000">WebGL</a>.<br />',
					'Find out how to get it <a href="http://get.webgl.org/" style="color:#000">here</a>.'
				].join( '\n' ) : [
					'Your browser does not seem to support <a href="http://khronos.org/webgl/wiki/Getting_a_WebGL_Implementation" style="color:#000">WebGL</a>.<br/>',
					'Find out how to get it <a href="http://get.webgl.org/" style="color:#000">here</a>.'
				].join( '\n' );

			}

			return element;

		},

		addGetWebGLMessage: function ( parameters ) {

			var parent, id, element;

			parameters = parameters || {};

			parent = parameters.parent !== undefined ? parameters.parent : document.body;
			id = parameters.id !== undefined ? parameters.id : 'oldie';

			element = Detector.getWebGLErrorMessage();
			element.id = id;

			parent.appendChild( element );

		}

	};

	//This library is designed to help start three.js easily, creating the render loop and canvas automagically.

	function ThreeasyEnvironment(canvasElem = null){
		this.prev_timestep = 0;
	    this.shouldCreateCanvas = (canvasElem === null);

		if(!Detector.webgl)Detector.addGetWebGLMessage();

	    //fov, aspect, near, far
		this.camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 0.1, 10000000 );
		//this.camera = new THREE.OrthographicCamera( 70, window.innerWidth / window.innerHeight, 0.1, 10 );

		this.camera.position.set(0, 0, 10);
		this.camera.lookAt(new THREE.Vector3(0,0,0));


		//create camera, scene, timer, renderer objects
		//craete render object


		
		this.scene = new THREE.Scene();
		this.scene.add(this.camera);

		//renderer
		let rendererOptions = { antialias: true};

	    if(!this.shouldCreateCanvas){
	        rendererOptions.canvas = canvasElem;
	    }

		this.renderer = new THREE.WebGLRenderer( rendererOptions );
		this.renderer.setPixelRatio( window.devicePixelRatio );
		this.renderer.setClearColor(new THREE.Color(0xFFFFFF), 1.0);


	    this.resizeCanvasIfNecessary(); //resize canvas to window size and set aspect ratio
		/*
		this.renderer.gammaInput = true;
		this.renderer.gammaOutput = true;
		this.renderer.shadowMap.enabled = true;
		this.renderer.vr.enabled = true;
		*/

		this.timeScale = 1;
		this.elapsedTime = 0;
		this.trueElapsedTime = 0;

	    if(this.shouldCreateCanvas){
		    this.container = document.createElement( 'div' );
		    this.container.appendChild( this.renderer.domElement );
	    }

		this.renderer.domElement.addEventListener( 'mousedown', this.onMouseDown.bind(this), false );
		this.renderer.domElement.addEventListener( 'mouseup', this.onMouseUp.bind(this), false );
		this.renderer.domElement.addEventListener( 'touchstart', this.onMouseDown.bind(this), false );
		this.renderer.domElement.addEventListener( 'touchend', this.onMouseUp.bind(this), false );

		/*
		//renderer.vr.enabled = true; 
		window.addEventListener( 'vrdisplaypointerrestricted', onPointerRestricted, false );
		window.addEventListener( 'vrdisplaypointerunrestricted', onPointerUnrestricted, false );
		document.body.appendChild( WEBVR.createButton( renderer ) );
		*/

		window.addEventListener('load', this.onPageLoad.bind(this), false);

		this.clock = new THREE.Clock();

		this.IS_RECORDING = false; // queryable if one wants to do things like beef up particle counts for render

	    if(!this.shouldCreateCanvas && canvasElem.offsetWidth){
	        //If the canvasElement is already loaded, then the 'load' event has already fired. We need to trigger it ourselves.
	        window.requestAnimationFrame(this.onPageLoad.bind(this));
	    }
	}

	ThreeasyEnvironment.prototype.onPageLoad = function() {
		console.log("Threeasy_Setup loaded!");
		if(this.shouldCreateCanvas){
			document.body.appendChild( this.container );
		}

		this.start();
	};
	ThreeasyEnvironment.prototype.start = function(){
		this.prev_timestep = performance.now();
		this.clock.start();
		this.render(this.prev_timestep);
	};

	ThreeasyEnvironment.prototype.onMouseDown = function() {
		this.isMouseDown = true;
	};
	ThreeasyEnvironment.prototype.onMouseUp= function() {
		this.isMouseDown = false;
	};
	ThreeasyEnvironment.prototype.onPointerRestricted= function() {
		var pointerLockElement = this.renderer.domElement;
		if ( pointerLockElement && typeof(pointerLockElement.requestPointerLock) === 'function' ) {
			pointerLockElement.requestPointerLock();
		}
	};
	ThreeasyEnvironment.prototype.onPointerUnrestricted= function() {
		var currentPointerLockElement = document.pointerLockElement;
		var expectedPointerLockElement = this.renderer.domElement;
		if ( currentPointerLockElement && currentPointerLockElement === expectedPointerLockElement && typeof(document.exitPointerLock) === 'function' ) {
			document.exitPointerLock();
		}
	};
	ThreeasyEnvironment.prototype.evenify = function(x){
		if(x % 2 == 1){
			return x+1;
		}
		return x;
	};
	ThreeasyEnvironment.prototype.resizeCanvasIfNecessary= function() {
	    //https://webgl2fundamentals.org/webgl/lessons/webgl-anti-patterns.html yes, every frame.
	    //this handles the edge case where the canvas size changes but the window size doesn't

	    let width = window.innerWidth;
	    let height = window.innerHeight;
	    
	    if(!this.shouldCreateCanvas){ // a canvas was provided externally
	        width = this.renderer.domElement.clientWidth;
	        height = this.renderer.domElement.clientHeight;
	    }

	    if(width != this.renderer.domElement.width || height != this.renderer.domElement.height){
	        //canvas dimensions changed, update the internal resolution

		    this.camera.aspect = width / height;
	        //this.camera.setFocalLength(30); //if I use this, the camera will keep a constant width instead of constant height
		    this.aspect = this.camera.aspect;
		    this.camera.updateProjectionMatrix();
		    this.renderer.setSize( this.evenify(width), this.evenify(height),this.shouldCreateCanvas );
	    }
	};
	ThreeasyEnvironment.prototype.listeners = {"update": [],"render":[]}; //update event listeners
	ThreeasyEnvironment.prototype.render = function(timestep){
	    this.resizeCanvasIfNecessary();

	    var realtimeDelta = this.clock.getDelta();
		var delta = realtimeDelta*this.timeScale;
		this.elapsedTime += delta;
	    this.trueElapsedTime += realtimeDelta;
		//get timestep
		for(var i=0;i<this.listeners["update"].length;i++){
			this.listeners["update"][i]({"t":this.elapsedTime,"delta":delta,'realtimeDelta':realtimeDelta});
		}

		this.renderer.render( this.scene, this.camera );

		for(var i=0;i<this.listeners["render"].length;i++){
			this.listeners["render"][i]();
		}

		this.prev_timestep = timestep;
		window.requestAnimationFrame(this.render.bind(this));
	};
	ThreeasyEnvironment.prototype.on = function(event_name, func){
		//Registers an event listener.
		//each listener will be called with an object consisting of:
		//	{t: <current time in s>, "delta": <delta, in ms>}
		// an update event fires before a render. a render event fires post-render.
		if(event_name == "update"){ 
			this.listeners["update"].push(func);
		}else if(event_name == "render"){ 
			this.listeners["render"].push(func);
		}else{
			console.error("Invalid event name!");
		}
	};
	ThreeasyEnvironment.prototype.removeEventListener = function(event_name, func){
		//Unregisters an event listener, undoing an Threeasy_setup.on() event listener.
		//the naming scheme might not be the best here.
		if(event_name == "update"){ 
			let index = this.listeners["update"].indexOf(func);
			this.listeners["update"].splice(index,1);
		} else if(event_name == "render"){ 
			let index = this.listeners["render"].indexOf(func);
			this.listeners["render"].splice(index,1);
		}else{
			console.error("Nonexistent event name!");
		}
	};
	ThreeasyEnvironment.prototype.off = ThreeasyEnvironment.prototype.removeEventListener; //alias to match ThreeasyEnvironment.on

	class ThreeasyRecorder extends ThreeasyEnvironment{
		//based on http://www.tysoncadenhead.com/blog/exporting-canvas-animation-to-mov/ to record an animation
		//when done,     ffmpeg -r 60 -framerate 60 -i ./%07d.png -vcodec libx264 -pix_fmt yuv420p -crf:v 0 video.mp4
	    // to perform motion blur on an oversampled video, ffmpeg -i video.mp4 -vf tblend=all_mode=average,framestep=2 video2.mp4
		//then, add the yuv420p pixels (which for some reason isn't done by the prev command) by:
		// ffmpeg -i video.mp4 -vcodec libx264 -pix_fmt yuv420p -strict -2 -acodec aac finished_video.mp4
		//check with ffmpeg -i finished_video.mp4

		constructor(fps=30, length = 5, canvasElem = null){
			/* fps is evident, autostart is a boolean (by default, true), and length is in s.*/
			super(canvasElem);
			this.fps = fps;
			this.elapsedTime = 0;
			this.frameCount = fps * length;
			this.frames_rendered = 0;

			this.capturer = new CCapture( {
				framerate: fps,
				format: 'png',
				name: document.title,
				//verbose: true,
			} );

			this.rendering = false;

			this.IS_RECORDING = true;
		}
		start(){
			//make a recording sign
			this.recording_icon = document.createElement("div");
			this.recording_icon.style.width="20px";
			this.recording_icon.style.height="20px";
			this.recording_icon.style.position = 'absolute';
			this.recording_icon.style.top = '20px';
			this.recording_icon.style.left = '20px';
			this.recording_icon.style.borderRadius = '10px';
			this.recording_icon.style.backgroundColor = 'red';
			document.body.appendChild(this.recording_icon);

			this.frameCounter = document.createElement("div");
			this.frameCounter.style.position = 'absolute';
			this.frameCounter.style.top = '20px';
			this.frameCounter.style.left = '50px';
			this.frameCounter.style.color = 'black';
			this.frameCounter.style.borderRadius = '10px';
			this.frameCounter.style.backgroundColor = 'rgba(255,255,255,0.1)';
			document.body.appendChild(this.frameCounter);

			this.capturer.start();
			this.rendering = true;
			this.render();
		}
		render(timestep){
	        var realtimeDelta = 1/this.fps;//ignoring the true time, calculate the delta
			var delta = realtimeDelta*this.timeScale; 
			this.elapsedTime += delta;
	        this.trueElapsedTime += realtimeDelta;

			//get timestep
			for(var i=0;i<this.listeners["update"].length;i++){
				this.listeners["update"][i]({"t":this.elapsedTime,"delta":delta, 'realtimeDelta':realtimeDelta});
			}

			this.renderer.render( this.scene, this.camera );

			for(var i=0;i<this.listeners["render"].length;i++){
				this.listeners["render"][i]();
			}


			this.record_frame();
			this.recording_icon.style.borderRadius = '10px';

			window.requestAnimationFrame(this.render.bind(this));
		}
		record_frame(){
		//	let current_frame = document.querySelector('canvas').toDataURL();

			this.capturer.capture( document.querySelector('canvas') );

			this.frameCounter.innerHTML = this.frames_rendered + " / " + this.frameCount; //update timer

			this.frames_rendered++;


			if(this.frames_rendered>this.frameCount){
				this.render = null; //hacky way of stopping the rendering
				this.recording_icon.style.display = "none";
				//this.frameCounter.style.display = "none";

				this.rendering = false;
				this.capturer.stop();
				// default save, will download automatically a file called {name}.extension (webm/gif/tar)
				this.capturer.save();
			}
		}
		resizeCanvasIfNecessary() {
			//stop recording if window size changes
			if(this.rendering && window.innerWidth / window.innerHeight != this.aspect){
				this.capturer.stop();
				this.render = null; //hacky way of stopping the rendering
				alert("Aborting record: Window-size change detected!");
				this.rendering = false;
				return;
			}
			super.resizeCanvasIfNecessary();
		}
	}

	function setupThree(fps=30, length = 5, canvasElem = null){
		var is_recording = false;

		//extract record parameter from url
		var params = new URLSearchParams(document.location.search);
		let recordString = params.get("record");

		if(recordString){ //detect if URL params include ?record=1 or ?record=true
	        recordString = recordString.toLowerCase();
	        is_recording = (recordString == "true" || recordString == "1");
	    }

	    let threeEnvironment = getThreeEnvironment();
	    if(threeEnvironment !== null){//singleton has already been created
	        return threeEnvironment;
	    }

		if(is_recording){
			threeEnvironment = new ThreeasyRecorder(fps, length, canvasElem);
		}else{
			threeEnvironment = new ThreeasyEnvironment(canvasElem);
		}
	    setThreeEnvironment(threeEnvironment);
	    return threeEnvironment;
	}

	async function delay(waitTime){
		return new Promise(function(resolve, reject){
			window.setTimeout(resolve, waitTime);
		});

	}

	//LineOutputShaders.js

	//based on https://mattdesl.svbtle.com/drawing-lines-is-hard but with several errors corrected, bevel shading added, and more

	const LINE_JOIN_TYPES = {"MITER": 0.2, "BEVEL":1.2,"ROUND":2.2}; //I'd use 0,1,2 but JS doesn't add a decimal place at the end when inserting them in a string. cursed justification

	var vShader = [
	"uniform float aspect;", //used to calibrate screen space
	"uniform float lineWidth;", //width of line
	"uniform float lineJoinType;",
	//"attribute vec3 position;", //added automatically by three.js
	"attribute vec3 nextPointPosition;",
	"attribute vec3 previousPointPosition;",
	"attribute float direction;",
	"attribute float approachNextOrPrevVertex;",

	"varying float crossLinePosition;",
	"attribute vec3 color;",
	"varying vec3 vColor;",
	"varying vec2 lineSegmentAClipSpace;",
	"varying vec2 lineSegmentBClipSpace;",
	"varying float thickness;",


	"varying vec3 debugInfo;",

	"vec3 angle_to_hue(float angle) {", //for debugging
	"  angle /= 3.141592*2.;",
	"  return clamp((abs(fract(angle+vec3(3.0, 2.0, 1.0)/3.0)*6.0-3.0)-1.0), 0.0, 1.0);",
	"}",

	//given an unit vector, move dist units perpendicular to it.
	"vec2 offsetPerpendicularAlongScreenSpace(vec2 dir, float twiceDist) {",
	  "vec2 normal = vec2(-dir.y, dir.x) ;",
	  "normal *= twiceDist/2.0;",
	  "normal.x /= aspect;",
	  "return normal;",
	"}",

	"void main() {",

	  "vec2 aspectVec = vec2(aspect, 1.0);",
	  "mat4 projViewModel = projectionMatrix *",
	            "viewMatrix * modelMatrix;",
	  "vec4 previousProjected = projViewModel * vec4(previousPointPosition, 1.0);",
	  "vec4 currentProjected = projViewModel * vec4(position, 1.0);",
	  "vec4 nextProjected = projViewModel * vec4(nextPointPosition, 1.0);",


	  //get 2D screen space with W divide and aspect correction
	  "vec2 currentScreen = currentProjected.xy / currentProjected.w * aspectVec;",
	  "vec2 previousScreen = previousProjected.xy / previousProjected.w * aspectVec;",
	  "vec2 nextScreen = nextProjected.xy / nextProjected.w * aspectVec;",

	  //"centerPointClipSpacePosition = currentProjected.xy / currentProjected.w;",//send to fragment shader
	  "crossLinePosition = direction;", //send direction to the fragment shader
	  "vColor = color;", //send direction to the fragment shader

	  "thickness = lineWidth / 400.;", //TODO: convert lineWidth to pixels
	  "float orientation = (direction-0.5)*2.;",

	  //get directions from (C - B) and (B - A)
	  "vec2 vecA = (currentScreen - previousScreen);",
	  "vec2 vecB = (nextScreen - currentScreen);",
	  "vec2 dirA = normalize(vecA);",
	  "vec2 dirB = normalize(vecB);",

	  //DEBUG
	  "lineSegmentAClipSpace = mix(previousScreen,currentScreen,approachNextOrPrevVertex) / aspectVec;",//send to fragment shader
	  "lineSegmentBClipSpace = mix(currentScreen,nextScreen,approachNextOrPrevVertex) / aspectVec;",//send to fragment shader

	  //starting point uses (next - current)
	  "vec2 offset = vec2(0.0);",
	  "if (currentScreen == previousScreen) {",
	  "  offset = offsetPerpendicularAlongScreenSpace(dirB * orientation, thickness);",
	  //offset += dirB * thickness; //end cap
	  "} ",
	  //ending point uses (current - previous)
	  "else if (currentScreen == nextScreen) {",
	  "  offset = offsetPerpendicularAlongScreenSpace(dirA * orientation, thickness);",
	  //offset += dirA * thickness; //end cap
	  "}",
	  "//somewhere in middle, needs a join",
	  "else {",
	  "  if (lineJoinType == "+LINE_JOIN_TYPES.MITER+") {",
	        //corner type: miter. This is buggy (there's no miter limit yet) so don't use
	  "    //now compute the miter join normal and length",
	  "    vec2 miterDirection = normalize(dirA + dirB);",
	  "    vec2 prevLineExtrudeDirection = vec2(-dirA.y, dirA.x);",
	  "    vec2 miter = vec2(-miterDirection.y, miterDirection.x);",
	  "    float len = thickness / (dot(miter, prevLineExtrudeDirection)+0.0001);", //calculate. dot product is always > 0
	  "    offset = offsetPerpendicularAlongScreenSpace(miterDirection * orientation, len);",
	  "  } else if (lineJoinType == "+LINE_JOIN_TYPES.BEVEL+"){",
	    //corner type: bevel
	  "    vec2 dir = mix(dirA, dirB, approachNextOrPrevVertex);",
	  "    offset = offsetPerpendicularAlongScreenSpace(dir * orientation, thickness);",
	  "  } else if (lineJoinType == "+LINE_JOIN_TYPES.ROUND+"){",
	    //corner type: round
	  "    vec2 dir = mix(dirA, dirB, approachNextOrPrevVertex);",
	  "    vec2 halfThicknessPastTheVertex = dir*thickness/2. * approachNextOrPrevVertex / aspectVec;",
	  "    offset = offsetPerpendicularAlongScreenSpace(dir * orientation, thickness) - halfThicknessPastTheVertex;", //extend rects past the vertex
	  "  } else {", //no line join type specified, just go for the previous point
	  "    offset = offsetPerpendicularAlongScreenSpace(dirA, thickness);",
	  "  }",
	  "}",

	  "debugInfo = vec3(approachNextOrPrevVertex, orientation, 0.0);", //TODO: remove. it's for debugging colors
	  "gl_Position = currentProjected + vec4(offset, 0.0,0.0) *currentProjected.w;",
	"}"].join("\n");

	var fShader = [
	"uniform float opacity;",
	"uniform vec2 screenSize;",
	"uniform float aspect;",
	"uniform float lineJoinType;",
	"varying vec3 vColor;",
	"varying vec3 debugInfo;",
	"varying vec2 lineSegmentAClipSpace;",
	"varying vec2 lineSegmentBClipSpace;",
	"varying float crossLinePosition;",
	"varying float thickness;",

	/* useful for debugging! from https://www.ronja-tutorials.com/2018/11/24/sdf-space-manipulation.html
	"vec3 renderLinesOutside(float dist){",
	"    float _LineDistance = 0.3;",
	"    float _LineThickness = 0.05;",
	"    float _SubLineThickness = 0.05;",
	"    float _SubLines = 1.0;",
	"    vec3 col = mix(vec3(1.0,0.2,0.2), vec3(0.0,0.2,1.2), step(0.0, dist));",

	"    float distanceChange = fwidth(dist) * 0.5;",
	"    float majorLineDistance = abs(fract(dist / _LineDistance + 0.5) - 0.5) * _LineDistance;",
	"    float majorLines = smoothstep(_LineThickness - distanceChange, _LineThickness + distanceChange, majorLineDistance);",

	"    float distanceBetweenSubLines = _LineDistance / _SubLines;",
	"    float subLineDistance = abs(fract(dist / distanceBetweenSubLines + 0.5) - 0.5) * distanceBetweenSubLines;",
	"    float subLines = smoothstep(_SubLineThickness - distanceChange, _SubLineThickness + distanceChange, subLineDistance);",

	"    return col * majorLines * subLines;",
	"}", */


	"float lineSDF(vec2 point, vec2 lineStartPt,vec2 lineEndPt) {",
	  "float h = clamp(dot(point-lineStartPt,lineEndPt-lineStartPt)/dot(lineEndPt-lineStartPt,lineEndPt-lineStartPt),0.0,1.0);",
	  "vec2 projectedVec = (point-lineStartPt-(lineEndPt-lineStartPt)*h);",
	  "return length(projectedVec);",
	"}",


	"void main(){",
	"  vec3 col = vColor.rgb;",
	//"  col = debugInfo.rgb;",
	"  gl_FragColor = vec4(col, opacity);",

	"  if (lineJoinType == "+LINE_JOIN_TYPES.ROUND+"){",
	"      vec2 vertScreenSpacePosition = gl_FragCoord.xy;", //goes from 0 to screenSize.xy
	"      vec2 linePtAScreenSpace = (lineSegmentAClipSpace+1.)/2. * screenSize;", //convert [-1,1] to [0,1], then *screenSize
	"      vec2 linePtBScreenSpace = (lineSegmentBClipSpace+1.)/2. * screenSize;",
	"      float distFromLine = lineSDF(vertScreenSpacePosition, linePtAScreenSpace,linePtBScreenSpace);",
	"      float sdf = 1.-(1./thickness /screenSize.y * 4.0 *distFromLine);",
	"      float sdfOpacity = clamp(sdf / (abs(dFdx(sdf)) + abs(dFdy(sdf))),0.0,1.0);",
	"      gl_FragColor = vec4(col, opacity * sdfOpacity );",
	"  }",
	"}"].join("\n");

	var uniforms = {
		lineWidth: {
			type: 'f',
			value: 1.0, //currently in units of yHeight*400
		},
		screenSize: {
			value: new THREE.Vector2( 1, 1 ),
		},
		lineJoinType: {
			type: 'f',
			value: LINE_JOIN_TYPES.ROUND,
		},
		opacity: {
			type: 'f',
			value: 1.0,
		},
		aspect: { //aspect ratio. need to load from renderer
			type: 'f',
			value: 1.0,
		}
	};

	class LineOutput extends OutputNode{
	    constructor(options = {}){
	        super();
	        /* should be .add()ed to a Transformation to work.
	        Crisp lines using the technique in https://mattdesl.svbtle.com/drawing-lines-is-hard, but also supporting mitered lines and beveled lines too!
	            options:
	            {
	                width: number. units are in screenY/400.
	                opacity: number
	                color: hex code or THREE.Color()
	                lineJoin: "bevel" or "round". default: round. Don't change this after initialization.
	            }
	        */

	        this._width = options.width !== undefined ? options.width : 5;
	        this._opacity = options.opacity !== undefined ? options.opacity : 1;
	        this._color = options.color !== undefined ? new THREE.Color(options.color) : new THREE.Color(0x55aa55);

	        this.lineJoinType = options.lineJoinType !== undefined ? options.lineJoinType.toUpperCase() : "ROUND";
	        if(LINE_JOIN_TYPES[this.lineJoinType] === undefined){
	            this.lineJoinType = "ROUND";
	        }

	        this.numCallsPerActivation = 0; //should always be equal to this.points.length
	        this.itemDimensions = []; // how many times to be called in each direction
	        this._outputDimensions = 3; //how many dimensions per point to store?

	        this.init();
	    }
	    init(){
	        this._geometry = new THREE.BufferGeometry();
	        this._vertices;
	        this.makeGeometry();


	        //make a deep copy of the uniforms template
	        this._uniforms = {};
	        for(var uniformName in uniforms){
	            this._uniforms[uniformName] = {
	                type: uniforms[uniformName].type,
	                value: uniforms[uniformName].value
	            };
	        }

	        this.material = new THREE.ShaderMaterial({
	            side: THREE.BackSide,
	            vertexShader: vShader, 
	            fragmentShader: fShader,
	            uniforms: this._uniforms,
	            extensions:{derivatives: true,},
	            transparent:true,
	        });

	        this.mesh = new THREE.Mesh(this._geometry,this.material);

	        this.opacity = this._opacity; // setter sets transparent flag if necessary
	        this.color = this._color; //setter sets color attribute
	        this._uniforms.opacity.value = this._opacity;
	        this._uniforms.lineWidth.value = this._width;
	        this._uniforms.lineJoinType.value = LINE_JOIN_TYPES[this.lineJoinType];

	        getThreeEnvironment().scene.add(this.mesh);
	    }

	    makeGeometry(){
	        const MAX_POINTS = 1000; //these arrays get discarded on first activation anyways
	        const NUM_POINTS_PER_VERTEX = 4;

	        let numVerts = (MAX_POINTS-1)*NUM_POINTS_PER_VERTEX;

	        this._vertices = new Float32Array(this._outputDimensions * numVerts);
	        this._nextPointVertices = new Float32Array(this._outputDimensions * numVerts);
	        this._prevPointVertices = new Float32Array(this._outputDimensions * numVerts);
	        this._colors = new Float32Array(numVerts * 3);

	        // build geometry

	        this._geometry.addAttribute( 'position', new THREE.Float32BufferAttribute( this._vertices, this._outputDimensions ) );
	        this._geometry.addAttribute( 'nextPointPosition', new THREE.Float32BufferAttribute( this._nextPointVertices, this._outputDimensions ) );
	        this._geometry.addAttribute( 'previousPointPosition', new THREE.Float32BufferAttribute( this._prevPointVertices, this._outputDimensions ) );
	        this._geometry.addAttribute( 'color', new THREE.Float32BufferAttribute( this._colors, 3 ) );

	        this._currentPointIndex = 0; //used during updates as a pointer to the buffer
	        this._activatedOnce = false;

	    }
	    _onAdd(){
	        //climb up parent hierarchy to find the Domain node we're rendering from
	        let root = null;
	        try{
	           root = this.getClosestDomain();
	        }catch(error){
	            console.warn(error);
	            return;
	        }
	    
	        //todo: implement something like assert root typeof RootNode

	        this.numCallsPerActivation = root.numCallsPerActivation;
	        this.itemDimensions = root.itemDimensions;
	    }
	    _onFirstActivation(){
	        this._onAdd(); //setup this.numCallsPerActivation and this.itemDimensions. used here again because cloning means the onAdd() might be called before this is connected to a type of domain

	        // perhaps instead of generating a whole new array, this can reuse the old one?

	        const NUM_POINTS_PER_LINE_SEGMENT = 4; //4 used for beveling
	        const numVerts = (this.numCallsPerActivation) * NUM_POINTS_PER_LINE_SEGMENT;

	        let vertices = new Float32Array( this._outputDimensions * numVerts);
	        let nextVertices = new Float32Array( this._outputDimensions * numVerts);
	        let prevVertices = new Float32Array( this._outputDimensions * numVerts);
	        let colors = new Float32Array( 3 * numVerts);

	        let positionAttribute = this._geometry.attributes.position;
	        this._vertices = vertices;
	        positionAttribute.setArray(this._vertices);

	        let prevPointPositionAttribute = this._geometry.attributes.previousPointPosition;
	        this._prevPointVertices = prevVertices;
	        prevPointPositionAttribute.setArray(this._prevPointVertices);

	        let nextPointPositionAttribute = this._geometry.attributes.nextPointPosition;
	        this._nextPointVertices = nextVertices;
	        nextPointPositionAttribute.setArray(this._nextPointVertices);

	        let colorAttribute = this._geometry.attributes.color;
	        this._colors = colors;
	        colorAttribute.setArray(this._colors);

	        //used to differentiate the left border of the line from the right border
	        let direction = new Float32Array(numVerts);
	        for(let i=0; i<numVerts;i++){
	            direction[i] = i%2==0 ? 1 : 0; //alternate -1 and 1
	        }
	        this._geometry.addAttribute( 'direction', new THREE.Float32BufferAttribute( direction, 1) );

	        //used to differentiate the points which move towards prev vertex from points which move towards next vertex
	        let nextOrPrev = new Float32Array(numVerts);
	        for(let i=0; i<numVerts;i++){
	            nextOrPrev[i] = i%4<2 ? 0 : 1; //alternate 0,0, 1,1
	        }
	        this._geometry.addAttribute( 'approachNextOrPrevVertex', new THREE.Float32BufferAttribute( nextOrPrev, 1) );

	        //indices
	        /*
	        For each vertex, we connect it to the next vertex like this:
	        n --n+2--n+4--n+6
	        |  /  | / |  /  |
	       n+1 --n+3--n+5--n+7

	       pt1   pt2 pt2   pt3

	       vertices n,n+1 are around point 1, n+2,n+3,n+4,n+5 are around pt2, n+6,n+7 are for point3. the middle segment (n+2-n+5) is the polygon used for beveling at point 2.

	        then we advance n two at a time to move to the next vertex. vertices n, n+1 represent the same point;
	        they're separated in the vertex shader to a constant screenspace width */
	        let indices = [];
	        for(let vertNum=0;vertNum<(this.numCallsPerActivation-1);vertNum +=1){ //not sure why this -3 is there. i guess it stops vertNum+3 two lines down from going somewhere it shouldn't?
	            let firstCoordinate = vertNum % this.itemDimensions[this.itemDimensions.length-1];
	            let endingNewLine = firstCoordinate == this.itemDimensions[this.itemDimensions.length-1]-1;
	    
	            let vertIndex = vertNum * NUM_POINTS_PER_LINE_SEGMENT;
	            
	            if(!endingNewLine){
	                //these triangles should be disabled when doing round joins
	                if(this.lineJoinType == "BEVEL"){
	                    indices.push( vertIndex+1, vertIndex,   vertIndex+2);
	                    indices.push( vertIndex+1, vertIndex+2, vertIndex+3);
	                }

	                indices.push( vertIndex+3, vertIndex+2, vertIndex+4);
	                indices.push( vertIndex+3, vertIndex+4, vertIndex+5);
	            }
	        }
	        this._geometry.setIndex( indices );

	        this.setAllVerticesToColor(this.color);

	        positionAttribute.needsUpdate = true;
	        colorAttribute.needsUpdate = true;
	    }
	    evaluateSelf(i, t, x, y, z){
	        if(!this._activatedOnce){
	            this._activatedOnce = true;
	            this._onFirstActivation();    
	        }

	        //it's assumed i will go from 0 to this.numCallsPerActivation, since this should only be called from an Area.

	        //assert i < vertices.count

	        let xValue =  x === undefined ? 0 : x;
	        let yValue =  y === undefined ? 0 : y;
	        let zValue =  z === undefined ? 0 : z;

	        this.saveVertexInfoInBuffers(this._vertices, this._currentPointIndex, xValue,yValue,zValue);

	        /* we're drawing like this:
	        *----*----*

	        *----*----*
	    
	        but we don't want to insert a diagonal line anywhere. This handles that:  */

	        let firstCoordinate = i % this.itemDimensions[this.itemDimensions.length-1];

	        //boolean variables. if in the future LineOutput can support variable-width lines, these should eb changed
	        let startingNewLine = firstCoordinate == 0;
	        let endingNewLine = firstCoordinate == this.itemDimensions[this.itemDimensions.length-1]-1;

	        if(startingNewLine){
	            //make the prevPoint be the same point as this
	            this.saveVertexInfoInBuffers(this._prevPointVertices, this._currentPointIndex, xValue,yValue,zValue);
	        }else{

	            let prevX = this._vertices[(this._currentPointIndex-1)*this._outputDimensions*4];
	            let prevY = this._vertices[(this._currentPointIndex-1)*this._outputDimensions*4+1];
	            let prevZ = this._vertices[(this._currentPointIndex-1)*this._outputDimensions*4+2];

	            //set this thing's prevPoint to the previous vertex
	            this.saveVertexInfoInBuffers(this._prevPointVertices, this._currentPointIndex, prevX,prevY,prevZ);

	            //set the PREVIOUS point's nextPoint to to THIS vertex.
	            this.saveVertexInfoInBuffers(this._nextPointVertices, this._currentPointIndex-1, xValue,yValue,zValue);
	        }

	        if(endingNewLine){
	            //make the nextPoint be the same point as this
	            this.saveVertexInfoInBuffers(this._nextPointVertices, this._currentPointIndex, xValue,yValue,zValue);
	        }
	        this._currentPointIndex++;
	    }

	    saveVertexInfoInBuffers(array, vertNum, value1,value2,value3){
	        //for every call to activate(), all 4 geometry vertices representing that point need to save that info.
	        //Therefore, this function will spread three coordinates into a given array, repeatedly.

	        let index = vertNum*this._outputDimensions*4;

	        array[index]   = value1;
	        array[index+1] = value2;
	        array[index+2] = value3;

	        array[index+3] = value1;
	        array[index+4] = value2;
	        array[index+5] = value3;

	        array[index+6] = value1;
	        array[index+7] = value2;
	        array[index+8] = value3;

	        array[index+9]  = value1;
	        array[index+10] = value2;
	        array[index+11] = value3;
	        
	    }
	    onAfterActivation(){
	        let positionAttribute = this._geometry.attributes.position;
	        positionAttribute.needsUpdate = true;
	        let prevPointPositionAttribute = this._geometry.attributes.previousPointPosition;
	        prevPointPositionAttribute.needsUpdate = true;
	        let nextPointPositionAttribute = this._geometry.attributes.nextPointPosition;
	        nextPointPositionAttribute.needsUpdate = true;

	        //update aspect ratio. in the future perhaps this should only be changed when the aspect ratio changes so it's not being done per frame?
	        if(this._uniforms){
	            const three = getThreeEnvironment();
	            this._uniforms.aspect.value = three.camera.aspect; //TODO: re-enable once debugging is done
	            three.renderer.getDrawingBufferSize(this._uniforms.screenSize.value); //modifies uniform in place
	        }

	        this._currentPointIndex = 0; //reset after each update
	    }
	    removeSelfFromScene(){
	        getThreeEnvironment().scene.remove(this.mesh);
	    }
	    setAllVerticesToColor(color){
	        const col = new THREE.Color(color);
	        const numVertices = (this.numCallsPerActivation-1)*2;
	        for(let i=0; i<numVertices;i++){
	            //Don't forget some points appear twice - as the end of one line segment and the beginning of the next.
	            this._setColorForVertexRGB(i, col.r, col.g, col.b);
	        }
	        //tell three.js to update colors
	    }
	    _setColorForVertex(vertexIndex, color){
	        //color is a THREE.Color here
	        this._setColorForVertexRGB(vertexIndex, color.r, color.g, color.b);
	    }
	    _setColorForVertexRGB(vertexIndex, normalizedR, normalizedG, normalizedB){
	        //all of normalizedR, normalizedG, normalizedB are 0-1.
	        let colorArray = this._geometry.attributes.color.array;
	        let index = vertexIndex * 3 * 4; //*3 because colors have 3 channels, *4 because 4 vertices/line point

	        colorArray[index + 0] = normalizedR;
	        colorArray[index + 1] = normalizedG;
	        colorArray[index + 2] = normalizedB;

	        colorArray[index + 3] = normalizedR;
	        colorArray[index + 4] = normalizedG;
	        colorArray[index + 5] = normalizedB;

	        colorArray[index + 6] = normalizedR;
	        colorArray[index + 7] = normalizedG;
	        colorArray[index + 8] = normalizedB;

	        colorArray[index + 9] = normalizedR;
	        colorArray[index + 10] = normalizedG;
	        colorArray[index + 11] = normalizedB;

	        let colorAttribute = this._geometry.attributes.color;
	        colorAttribute.needsUpdate = true;
	    }
	    set color(color){
	        //currently only a single color is supported.
	        //I should really make it possible to specify color by a function.
	        this._color = color;
	        this.setAllVerticesToColor(color);
	    }
	    get color(){
	        return this._color;
	    }
	    set opacity(opacity){
	        this.material.opacity = opacity;
	        //this.material.transparent = opacity < 1;
	        this.material.visible = opacity > 0;
	        this._opacity = opacity;
	        this._uniforms.opacity.value = opacity;
	    }
	    get opacity(){
	        return this._opacity;
	    }
	    set width(width){
	        this._width = width;
	        this._uniforms.lineWidth.value = width;
	    }
	    get width(){
	        return this._width;
	    }
	    clone(){
	        return new LineOutput({width: this.width, color: this.color, opacity: this.opacity});
	    }
	}

	class PointOutput extends OutputNode{
		constructor(options = {}){
			super();
			/*
				width: number
				color: hex color, as in 0xrrggbb. Technically, this is a JS integer.
				opacity: 0-1. Optional.
			*/

			this._width = options.width !== undefined ? options.width : 1;
			this._color = options.color !== undefined ? new THREE.Color(options.color) : new THREE.Color(0x55aa55);
			this._opacity = options.opacity !== undefined ? options.opacity : 1;

			this.points = [];

	        this.material = new THREE.MeshBasicMaterial({color: this._color});
	        this.opacity = this._opacity; //trigger setter to set this.material's opacity properly

			this.numCallsPerActivation = 0; //should always be equal to this.points.length
			this._activatedOnce = false;
		}
		_onAdd(){ //should be called when this is .add()ed to something
			//climb up parent hierarchy to find the Area
			let root = this.getClosestDomain();

			this.numCallsPerActivation = root.numCallsPerActivation;

			if(this.points.length < this.numCallsPerActivation){
				for(var i=this.points.length;i<this.numCallsPerActivation;i++){
					this.points.push(new PointMesh({width: 1,material:this.material}));
					this.points[i].mesh.scale.setScalar(this._width); //set width by scaling point
				}
			}
		}
		_onFirstActivation(){
			if(this.points.length < this.numCallsPerActivation)this._onAdd();
		}
		evaluateSelf(i, t, x, y, z){
			if(!this._activatedOnce){
				this._activatedOnce = true;
				this._onFirstActivation();	
			}
			//it's assumed i will go from 0 to this.numCallsPerActivation, since this should only be called from an Area.
			var point = this.getPoint(i);
			point.x = x === undefined ? 0 : x;
			point.y = y === undefined ? 0 : y;
			point.z = z === undefined ? 0 : z;
		}
		getPoint(i){
			return this.points[i];
		}
	    removeSelfFromScene(){
			for(var i=0;i<this.points.length;i++){
				this.points[i].removeSelfFromScene();
			}
	    }
		set opacity(opacity){
			//technically this sets all points to the same color. Todo: allow different points to be differently colored.
			
			let mat = this.material;
			mat.opacity = opacity; //instantiate the point
			mat.transparent = opacity < 1;
	        mat.visible = opacity > 0;
			this._opacity = opacity;
		}
		get opacity(){
			return this._opacity;
		}
		set color(color){
	        this.material.color = color;
			this._color = color;
		}
		get color(){
			return this._color;
		}
		set width(width){
			for(var i=0;i<this.points.length;i++){
				this.getPoint(i).mesh.scale.setScalar(width);
			}
			this._width = width;
		}
		get width(){
			return this._width;
		}
		clone(){
			return new PointOutput({width: this.width, color: this.color, opacity: this.opacity});
		}
	}


	class PointMesh{
		constructor(options){
			/*options:
				x,y: numbers
				width: number
	            material: 
			*/

			let width = options.width === undefined ? 1 : options.width;
	        this.material = options.material; //one material per PointOutput

			this.mesh = new THREE.Mesh(this.sharedCircleGeometry,this.material);

			this.mesh.position.set(this.x,this.y,this.z);
			this.mesh.scale.setScalar(this.width/2);
			exports.threeEnvironment.scene.add(this.mesh);

			this.x = options.x || 0;
			this.y = options.y || 0;
			this.z = options.z || 0;
		}
		removeSelfFromScene(){
			exports.threeEnvironment.scene.remove(this.mesh);
		}
		set x(i){
			this.mesh.position.x = i;
		}
		set y(i){
			this.mesh.position.y = i;
		}
		set z(i){
			this.mesh.position.z = i;
		}
		get x(){
			return this.mesh.position.x;
		}
		get y(){
			return this.mesh.position.y;
		}
		get z(){
			return this.mesh.position.z;
		}
	}
	PointMesh.prototype.sharedCircleGeometry = new THREE.SphereGeometry(1/2, 8, 6); //radius 1/2 makes diameter 1, so that scaling by n means width=n

	class VectorOutput extends LineOutput{
	    constructor(options = {}){
	        /*input: Transformation
	            width: number
	        */
	        super(options);

	    }
	    init(){
	        this.arrowMaterial = new THREE.LineBasicMaterial({color: this._color, linewidth: this._width, opacity:this._opacity});

	        super.init();
	        this.arrowheads = [];

	        //TODO: make the arrow tip colors match the colors of the lines' tips

	        const circleResolution = 12;
	        const arrowheadSize = 0.3;
	        const EPSILON = 0.00001;
	        this.EPSILON = EPSILON;

	        this.coneGeometry = new THREE.CylinderBufferGeometry( 0, arrowheadSize, arrowheadSize*1.7, circleResolution, 1 );
	        let arrowheadOvershootFactor = 0.1; //used so that the line won't rudely clip through the point of the arrowhead
	        this.coneGeometry.translate( 0, - arrowheadSize + arrowheadOvershootFactor, 0 );
	        this._coneUpDirection = new THREE.Vector3(0,1,0);
	    }
	    _onFirstActivation(){
	        super._onFirstActivation();

	        if(this.itemDimensions.length > 1){
	            this.numArrowheads = this.itemDimensions.slice(0,this.itemDimensions.length-1).reduce(function(prev, current){
	                return current + prev;
	            });
	        }else{
	            //assumed itemDimensions isn't a nonzero array. That should be the constructor's problem.
	            this.numArrowheads = 1;
	        }

	        //remove any previous arrowheads
	        for(var i=0;i<this.arrowheads.length;i++){
	            let arrow = this.arrowheads[i];
	            exports.threeEnvironment.scene.remove(arrow);
	        }

	        this.arrowheads = new Array(this.numArrowheads);
	        for(var i=0;i<this.numArrowheads;i++){
	            this.arrowheads[i] = new THREE.Mesh(this.coneGeometry, this.arrowMaterial);
	            this.mesh.add(this.arrowheads[i]);
	        }
	        console.log("number of arrowheads (= number of lines):"+ this.numArrowheads);
	    }
	    evaluateSelf(i, t, x, y, z){
	        //it's assumed i will go from 0 to this.numCallsPerActivation, since this should only be called from an Area.
	        super.evaluateSelf(i,t,x,y,z);

	        const lastDimensionLength = this.itemDimensions[this.itemDimensions.length-1];
	        let firstCoordinate = i % lastDimensionLength;
	        let endingNewLine = firstCoordinate == lastDimensionLength-1;

	        if(endingNewLine){
	            //we need to update arrows
	            //calculate direction of last line segment
	            //this point is currentPointIndex-1 because currentPointIndex was increased by 1 during super.evaluateSelf()
	            let index = (this._currentPointIndex-1)*this._outputDimensions*4;

	            let prevX = this._vertices[(this._currentPointIndex-2)*this._outputDimensions*4];
	            let prevY = this._vertices[(this._currentPointIndex-2)*this._outputDimensions*4+1];
	            let prevZ = this._vertices[(this._currentPointIndex-2)*this._outputDimensions*4+2];

	            let dx = prevX - this._vertices[index];
	            let dy = prevY - this._vertices[index+1];
	            let dz = prevZ - this._vertices[index+2];

	            let lineNumber = Math.floor(i / lastDimensionLength);
	            Utils.assert(lineNumber <= this.numArrowheads); //this may be wrong

	            let directionVector = new THREE.Vector3(-dx,-dy,-dz);

	            //Make arrows disappear if the line is small enough
	            //One way to do this would be to sum the distances of all line segments. I'm cheating here and just measuring the distance of the last vector, then multiplying by the number of line segments (naively assuming all line segments are the same length)
	            let length = directionVector.length() * (lastDimensionLength-1);

	            const effectiveDistance = 3;
	            let clampedLength = Math.max(0, Math.min(length/effectiveDistance, 1));

	            //shrink function designed to have a steep slope close to 0 but mellow out at 0.5 or so in order to avoid the line width overcoming the arrowhead width
	            //In Chrome, three.js complains whenever something is set to 0 scale. Adding an epsilon term is unfortunate but necessary to avoid console spam.
	            this.arrowheads[lineNumber].scale.setScalar(Math.acos(1-2*clampedLength)/Math.PI + this.EPSILON);
	            
	             //position/rotation comes after since .normalize() modifies directionVector in place
	            let pos = this.arrowheads[lineNumber].position;
	            pos.x = x === undefined ? 0 : x;
	            pos.y = y === undefined ? 0 : y;
	            pos.z = z === undefined ? 0 : z;

	            if(length > 0){ //directionVector.normalize() fails with 0 length
	                this.arrowheads[lineNumber].quaternion.setFromUnitVectors(this._coneUpDirection, directionVector.normalize() );
	            }
	        }
	    }


	    set color(color){
	        //currently only a single color is supported.
	        //I should really make it possible to specify color by a function.
	        this._color = color;
	        this.setAllVerticesToColor(color);
	        this.arrowMaterial.color = this._color;
	    }

	    get color(){
	        return this._color;
	    }

	    set opacity(opacity){
	        this.arrowMaterial.opacity = opacity;
	        this.arrowMaterial.transparent = opacity < 1;
	        this.arrowMaterial.visible = opacity > 0;

	        this.material.opacity = opacity;
	        this.material.transparent = opacity < 1;
	        this.material.visible = opacity > 0;
	        this._opacity = opacity;
	        this._uniforms.opacity.value = opacity;
	    }

	    get opacity(){
	        return this._opacity;
	    }
	    removeSelfFromScene(){
	        exports.threeEnvironment.scene.remove(this.mesh);
	        for(var i=0;i<this.numArrowheads;i++){
	            exports.threeEnvironment.scene.remove(this.arrowheads[i]);
	        }
	    }
	    clone(){
	        return new VectorOutput({width: this.width, color: this.color, opacity: this.opacity});
	    }
	}

	//SurfaceOutputShaders.js

	//experiment: shaders to get the triangle pulsating!
	var vShader$1 = [
	"varying vec3 vNormal;",
	"varying vec3 vPosition;",
	"varying vec2 vUv;",
	"uniform float time;",
	"uniform vec3 color;",
	"uniform vec3 vLight;",
	"uniform float gridSquares;",

	"void main() {",
		"vPosition = position.xyz;",
		"vNormal = normal.xyz;",
		"vUv = uv.xy;",
		"gl_Position = projectionMatrix *",
	            "modelViewMatrix *",
	            "vec4(position,1.0);",
	"}"].join("\n");

	var fShader$1 = [
	"varying vec3 vNormal;",
	"varying vec3 vPosition;",
	"varying vec2 vUv;",
	"uniform float time;",
	"uniform vec3 color;",
	"uniform float useCustomGridColor;",
	"uniform vec3 gridColor;",
	"uniform vec3 vLight;",
	"uniform float gridSquares;",
	"uniform float lineWidth;",
	"uniform float showGrid;",
	"uniform float showSolid;",
	"uniform float opacity;",

		//the following code from https://github.com/unconed/mathbox/blob/eaeb8e15ef2d0252740a74505a12d7a1051a61b6/src/shaders/glsl/mesh.fragment.shaded.glsl
	"vec3 offSpecular(vec3 color) {",
	"  vec3 c = 1.0 - color;",
	"  return 1.0 - c * c;",
	"}",

	"vec4 getShadedColor(vec4 rgba) { ",
	"  vec3 color = rgba.xyz;",
	"  vec3 color2 = offSpecular(rgba.xyz);",

	"  vec3 normal = normalize(vNormal);",
	"  vec3 light = normalize(vLight);",
	"  vec3 position = normalize(vPosition);",

	"  float side    = gl_FrontFacing ? -1.0 : 1.0;",
	"  float cosine  = side * dot(normal, light);",
	"  float diffuse = mix(max(0.0, cosine), .5 + .5 * cosine, .1);",

	"  float rimLighting = max(min(1.0 - side*dot(normal, light), 1.0),0.0);",

	"	float specular = max(0.0, abs(cosine) - 0.5);", //double sided specular
	"   return vec4(diffuse*color + 0.9*rimLighting*color + 0.4*color2 * specular, rgba.a);",
	"}",

	// Smooth HSV to RGB conversion from https://www.shadertoy.com/view/MsS3Wc
	"vec3 hsv2rgb_smooth( in vec3 c ){",
	"    vec3 rgb = clamp( abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0 );",
	"	rgb = rgb*rgb*(3.0-2.0*rgb); // cubic smoothing	",
	"	return c.z * mix( vec3(1.0), rgb, c.y);",
	"}",

	//From Sam Hocevar: http://lolengine.net/blog/2013/07/27/rgb-to-hsv-in-glsl
	"vec3 rgb2hsv(vec3 c){",
	"    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);",
	"    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));",
	"    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));",

	"    float d = q.x - min(q.w, q.y);",
	"    float e = 1.0e-10;",
	"    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);",
	"}",
	 //chooses the color for the gridlines by varying lightness. 
	//NOT continuous or else by the intermediate function theorem there'd be a point where the gridlines were the same color as the material.
	"vec3 gridLineColor(vec3 color){",
	" vec3 hsv = rgb2hsv(color.xyz);",
	" //hsv.x += 0.1;",
	" if(hsv.z < 0.8){hsv.z += 0.2;}else{hsv.z = 0.85-0.1*hsv.z;hsv.y -= 0.0;}",
	" return hsv2rgb_smooth(hsv);",
	"}",

	"vec4 renderGridlines(vec4 existingColor, vec2 uv, vec4 solidColor) {",
	"  vec2 distToEdge = abs(mod(vUv.xy*gridSquares + lineWidth/2.0,1.0));",
	"  vec3 chosenGridLineColor = mix(gridLineColor(solidColor.xyz), gridColor, useCustomGridColor); ", //use either gridLineColor() or override with custom grid
	"  vec3 blendedGridLine = showSolid * chosenGridLineColor + (1.0-showSolid)*solidColor.xyz;", //if showSolid =0, use solidColor as the gridline color, otherwise shade

	"  if( distToEdge.x < lineWidth || distToEdge.y < lineWidth){",
	"    return mix(existingColor, vec4(blendedGridLine, 1.0),showGrid);",
	"  }",
	"  return existingColor;",
	"}",
	/*
	"vec4 getShadedColorMathbox(vec4 rgba) { ",
	"  vec3 color = rgba.xyz;",
	"  vec3 color2 = offSpecular(rgba.xyz);",

	"  vec3 normal = normalize(vNormal);",
	"  vec3 light = normalize(vLight);",
	"  vec3 position = normalize(vPosition);",
	"  float side    = gl_FrontFacing ? -1.0 : 1.0;",
	"  float cosine  = side * dot(normal, light);",
	"  float diffuse = mix(max(0.0, cosine), .5 + .5 * cosine, .1);",
	"   vec3  halfLight = normalize(light + position);",
	"	float cosineHalf = max(0.0, side * dot(normal, halfLight));",
	"	float specular = pow(cosineHalf, 16.0);",
	"	return vec4(color * (diffuse * .9 + .05) *0.0 +  .25 * color2 * specular, rgba.a);",
	"}",*/

	"void main(){",
	//"  //gl_FragColor = vec4(vNormal.xyz, 1.0); // view debug normals",
	//"  //if(vNormal.x < 0.0){gl_FragColor = vec4(offSpecular(color.rgb), 1.0);}else{gl_FragColor = vec4((color.rgb), 1.0);}", //view specular and non-specular colors
	//"  gl_FragColor = vec4(mod(vUv.xy,1.0),0.0,1.0); //show uvs
	"  vec4 solidColor = vec4(color.rgb, showSolid);",
	"  vec4 solidColorOut = showSolid*getShadedColor(solidColor);",
	"  vec4 colorWithGridlines = renderGridlines(solidColorOut, vUv.xy, solidColor);",
	"  colorWithGridlines.a *= opacity;",
	"  gl_FragColor = colorWithGridlines;",	
	"}"].join("\n");

	var uniforms$1 = {
		time: {
			type: 'f',
			value: 0,
		},
		color: {
			type: 'c',
			value: new THREE.Color(0x55aa55),
		},
		useCustomGridColor: {
			type: 'f',
			value: 0,
		},
		gridColor: {
			type: 'c',
			value: new THREE.Color(0x55aa55),
		},
		opacity: {
			type: 'f',
			value: 0.1,
		},
		vLight: { //light direction
			type: 'vec3',
			value: [0,0,1],
		},
		gridSquares: {
			type: 'f',
			value: 4,
		},
		lineWidth: {
			type: 'f',
			value: 0.1,
		},
		showGrid: {
			type: 'f',
			value: 1.0,
		},
		showSolid: {
			type: 'f',
			value: 1.0,
		}
	};

	class SurfaceOutput extends OutputNode{
		constructor(options = {}){
			super();
			/* should be .add()ed to a Transformation to work
				options:
				{
					opacity: number
					color: hex code or THREE.Color(). Diffuse color of this surface.
					gridColor: hex code or THREE.Color(). If showGrid is true, grid lines will appear over this surface. gridColor determines their color 
					showGrid: boolean. If true, will display a gridColor-colored grid over the surface. Default: true
					showSolid: boolean. If true, will display a solid surface. Default: true
					gridSquares: number representing how many squares per dimension to use in a rendered grid
					gridLineWidth: number representing how many squares per dimension to use in a rendered grid
				}
			*/
			this._opacity = options.opacity !== undefined ? options.opacity : 1;

			this._color = options.color !== undefined ? new THREE.Color(options.color) : new THREE.Color(0x55aa55);

			this._gridColor = options.gridColor !== undefined ? new THREE.Color(options.gridColor) : new THREE.Color(0x55aa55);
	        this._useCustomGridColor = options.gridColor !== undefined;

			this._gridSquares = options.gridSquares !== undefined ? options.gridSquares : 16;
			this._showGrid = options.showGrid !== undefined ? options.showGrid : true;
			this._showSolid = options.showSolid !== undefined ? options.showSolid : true;
			this._gridLineWidth = options.gridLineWidth !== undefined ? options.gridLineWidth : 0.15;

			this.numCallsPerActivation = 0; //should always be equal to this.vertices.length
			this.itemDimensions = []; // how many times to be called in each direction
			this._outputDimensions = 3; //how many dimensions per point to store?

			this.init();
		}
		init(){
			this._geometry = new THREE.BufferGeometry();
			this._vertices;
			this.makeGeometry();

			//make a deep copy of the uniforms template
			this._uniforms = {};
			for(var uniformName in uniforms$1){
				this._uniforms[uniformName] = {
					type: uniforms$1[uniformName].type,
					value: uniforms$1[uniformName].value
				};
			}

			this.material = new THREE.ShaderMaterial({
				side: THREE.BackSide,
				vertexShader: vShader$1, 
				fragmentShader: fShader$1,
				uniforms: this._uniforms,
				});
			this.mesh = new THREE.Mesh(this._geometry,this.material);

			this.opacity = this._opacity; // setter sets transparent flag if necessary
			this.color = this._color; //setter sets color uniform
			this._uniforms.opacity.value = this._opacity;
			this._uniforms.gridSquares.value = this._gridSquares;
			this._uniforms.showGrid.value = this.toNum(this._showGrid);
			this._uniforms.showSolid.value = this.toNum(this._showSolid);
			this._uniforms.lineWidth.value = this._gridLineWidth;
	        this._uniforms.useCustomGridColor = this._useCustomGridColor;

			if(!this.showSolid)this.material.transparent = true;

			getThreeEnvironment().scene.add(this.mesh);
		}
	    toNum(x){
	        if(x == false)return 0;
	        if(x == true)return 1;
	        return x;
	    }
		makeGeometry(){

			let MAX_POINTS = 10000;

			this._vertices = new Float32Array(MAX_POINTS * this._outputDimensions);
			this._normals = new Float32Array(MAX_POINTS * 3);
			this._uvs = new Float32Array(MAX_POINTS * 2);

			// build geometry

			this._geometry.addAttribute( 'position', new THREE.Float32BufferAttribute( this._vertices, this._outputDimensions ) );
			this._geometry.addAttribute( 'normal', new THREE.Float32BufferAttribute( this._normals, 3 ) );
			this._geometry.addAttribute( 'uv', new THREE.Float32BufferAttribute( this._uvs, 2 ) );

			this._currentPointIndex = 0; //used during updates as a pointer to the buffer

			this._activatedOnce = false;

		}
		_setUVs(uvs, index, u, v){

		}
		_onFirstActivation(){
	        //setup this.numCallsPerActivation and this.itemDimensions. used here again because cloning means the onAdd() might be called before this is connected to a type of domain

			//climb up parent hierarchy to find the DomainNode we're rendering from
			let root = this.getClosestDomain();
			this.numCallsPerActivation = root.numCallsPerActivation;
			this.itemDimensions = root.itemDimensions;

			// perhaps instead of generating a whole new array, this can reuse the old one?
			let vertices = new Float32Array(this.numCallsPerActivation * this._outputDimensions);
			let normals = new Float32Array(this.numCallsPerActivation * 3);
			let uvs = new Float32Array(this.numCallsPerActivation * 2);

			let positionAttribute = this._geometry.attributes.position;
			this._vertices = vertices;
			positionAttribute.setArray(this._vertices);
			positionAttribute.needsUpdate = true;

			let normalAttribute = this._geometry.attributes.normal;
			this._normals = normals;
			normalAttribute.setArray(this._normals);
			normalAttribute.needsUpdate = true;

			let uvAttribute = this._geometry.attributes.uv;


			//assert this.itemDimensions[0] * this.itemDimensions[1] = this.numCallsPerActivation and this._outputDimensions == 2
			var indices = [];
			let i=0, j=0;
			for(j=0;j<this.itemDimensions[0]-1;j++){
				for(i=0;i<this.itemDimensions[1]-1;i++){

					let a = i + j * this.itemDimensions[1];
					let b = i + (j+1) * this.itemDimensions[1];
					let c = (i+1)+ (j+1) * this.itemDimensions[1];
					let d = (i+1)+ j * this.itemDimensions[1];

	        		indices.push(a, b, d);
					indices.push(b, c, d);
					
					//double sided reverse faces
	        		indices.push(d, b, a);
					indices.push(d, c, b);

				}
			}

			//normals (will be overwritten later) and uvs
			for(j=0;j<this.itemDimensions[0];j++){
				for(i=0;i<this.itemDimensions[1];i++){

					let pointIndex = i + j * this.itemDimensions[1];
					//set normal to [0,0,1] as a temporary value
					normals[(pointIndex)*3] = 0;
					normals[(pointIndex)*3+1] = 0;
					normals[(pointIndex)*3+2] = 1;

					//uvs
					uvs[(pointIndex)*2] = j/(this.itemDimensions[0]-1);
					uvs[(pointIndex)*2+1] = i/(this.itemDimensions[1]-1);
				}
			}

			this._uvs = uvs;
			uvAttribute.setArray(this._uvs);
			uvAttribute.needsUpdate = true;

			this._geometry.setIndex( indices );
		}
		evaluateSelf(i, t, x, y, z){
			if(!this._activatedOnce){
				this._activatedOnce = true;
				this._onFirstActivation();	
			}

			//it's assumed i will go from 0 to this.numCallsPerActivation, since this should only be called from an Area.

			//assert i < vertices.count

			let index = this._currentPointIndex*this._outputDimensions;

		    this._vertices[index]   = x === undefined ? 0 : x;
			this._vertices[index+1] = y === undefined ? 0 : y;
			this._vertices[index+2] = z === undefined ? 0 : z;

			this._currentPointIndex++;
		}
		onAfterActivation(){
			let positionAttribute = this._geometry.attributes.position;
			positionAttribute.needsUpdate = true;

			this._recalcNormals();
			let normalAttribute = this._geometry.attributes.normal;
			normalAttribute.needsUpdate = true;

			this._currentPointIndex = 0; //reset after each update
		}
		_recalcNormals(){
			let positionAttribute = this._geometry.attributes.position;
			let normalAttribute = this._geometry.attributes.normal;
			//rendered triangle indices
			//from three.js PlaneGeometry.js
			let normalVec = new THREE.Vector3();
			let partialX = new THREE.Vector3();
			let partialY = new THREE.Vector3();
			let negationFactor = 1;
			let i=0, j=0;
			for(j=0;j<this.itemDimensions[0];j++){
				for(i=0;i<this.itemDimensions[1];i++){

					//currently doing the normal for the point at index a.
					let a = i + j * this.itemDimensions[1];
					let b,c;

					//Tangents are calculated with finite differences - For (x,y), compute the partial derivatives using (x+1,y) and (x,y+1) and cross them. But if you're at theborder, x+1 and y+1 might not exist. So in that case we go backwards and use (x-1,y) and (x,y-1) instead.
					//When that happens, the vector subtraction will subtract the wrong way, introducing a factor of -1 into the cross product term. So negationFactor keeps track of when that happens and is multiplied again to cancel it out.
					negationFactor = 1; 

					//b is the index of the point 1 away in the y direction
					if(i < this.itemDimensions[1]-1){
						b = (i+1) + j * this.itemDimensions[1];
					}else{
						//end of the y axis, go backwards for tangents
						b = (i-1) + j * this.itemDimensions[1];
						negationFactor *= -1;
					}

					//c is the index of the point 1 away in the x direction
					if(j < this.itemDimensions[0]-1){
						c = i + (j+1) * this.itemDimensions[1];
					}else{
						//end of the x axis, go backwards for tangents
						c = i + (j-1) * this.itemDimensions[1];
						negationFactor *= -1;
					}

					//the vector b-a. 
					//this._vertices stores the components of each vector in one big float32array, so this pulls them out and just does the subtraction numerically. The components of vector #52 are x:52*3+0,y:52*3+1,z:52*3+2, for example.
					partialY.set(this._vertices[b*3]-this._vertices[a*3],this._vertices[b*3+1]-this._vertices[a*3+1],this._vertices[b*3+2]-this._vertices[a*3+2]);
					//the vector c-a.
					partialX.set(this._vertices[c*3]-this._vertices[a*3],this._vertices[c*3+1]-this._vertices[a*3+1],this._vertices[c*3+2]-this._vertices[a*3+2]);

					//b-a cross c-a
					normalVec.crossVectors(partialX,partialY).normalize();
					normalVec.multiplyScalar(negationFactor);
					//set normal
					this._normals[(i + j * this.itemDimensions[1])*3] = normalVec.x;
					this._normals[(i + j * this.itemDimensions[1])*3+1] = normalVec.y;
					this._normals[(i + j * this.itemDimensions[1])*3+2] = normalVec.z;
				}
			}
			// don't forget to normalAttribute.needsUpdate = true after calling this!
		}
	    removeSelfFromScene(){
	        threeEnvironment.scene.remove(this.mesh);
	    }
		set color(color){
			//currently only a single color is supported.
			//I should really make this a function
			this._color = color;
			this._uniforms.color.value = new THREE.Color(color);
		}
		get color(){
			return this._color;
		}
		set gridColor(color){
			//currently only a single color is supported.
			//I should really make this a function
			this._gridColor = color;
			this._uniforms.gridColor.value = new THREE.Color(color);
	        this._uniforms.useCustomGridColor = 1.0;
		}
		get gridColor(){
			return this._gridColor;
		}
		set opacity(opacity){
			this.material.opacity = opacity;
			this.material.transparent = (opacity < 1) || (!this.showSolid);
			this.material.visible = opacity > 0;
			this._opacity = opacity;
	        this._uniforms.opacity.value = opacity;
		}
		get opacity(){
			return this._opacity;
		}
		clone(){
			return new SurfaceOutput({color: this.color, opacity: this.opacity});
		}
	}

	class FlatArrayOutput extends OutputNode{
	    //an output which fills an array with every coordinate recieved, in order.
	    //It'll register [0,1,2],[3,4,5] as [0,1,2,3,4,5].
		constructor(options = {}){
			super();
			/*
				array: an existing array, which will then be modified in place every time this output is activated
			*/

			this.array = options.array;
	        this._currentArrayIndex = 0;
		}
		evaluateSelf(i, t, ...coords){
	        for(var j=0;j<coords.length;j++){ 
	            //I don't need to worry about out-of-bounds entries because javascript automatically grows arrays if a new index is set.
	            //Javascript may have some garbage design choices, but I'll claim that garbage for my own nefarious advantage.
	            this.array[this._currentArrayIndex] = coords[j];
	            this._currentArrayIndex++;
	        }
		}
		onAfterActivation(){
	        this._currentArrayIndex = 0;
		}
		clone(){
			return new FlatArrayOutput({array: EXP.Math.clone(this.array)});
		}
	}

	var explanarianArrowSVG = "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjwhLS0gQ3JlYXRlZCB3aXRoIElua3NjYXBlIChodHRwOi8vd3d3Lmlua3NjYXBlLm9yZy8pIC0tPgoKPHN2ZwogICB4bWxuczpkYz0iaHR0cDovL3B1cmwub3JnL2RjL2VsZW1lbnRzLzEuMS8iCiAgIHhtbG5zOmNjPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyMiCiAgIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyIKICAgeG1sbnM6c3ZnPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIKICAgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogICB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIKICAgeG1sbnM6c29kaXBvZGk9Imh0dHA6Ly9zb2RpcG9kaS5zb3VyY2Vmb3JnZS5uZXQvRFREL3NvZGlwb2RpLTAuZHRkIgogICB4bWxuczppbmtzY2FwZT0iaHR0cDovL3d3dy5pbmtzY2FwZS5vcmcvbmFtZXNwYWNlcy9pbmtzY2FwZSIKICAgd2lkdGg9IjIwMCIKICAgaGVpZ2h0PSIxMzAiCiAgIHZpZXdCb3g9IjAgMCAyMDAgMTMwIgogICBpZD0ic3ZnMiIKICAgdmVyc2lvbj0iMS4xIgogICBpbmtzY2FwZTp2ZXJzaW9uPSIwLjkxIHIxMzcyNSIKICAgc29kaXBvZGk6ZG9jbmFtZT0iRXhwbGFuYXJpYW5OZXh0QXJyb3cuc3ZnIj4KICA8ZGVmcz4KPHJhZGlhbEdyYWRpZW50IGlkPSJhIiBjeD0iNTAwIiBjeT0iNjI3LjcxIiByPSIyNDIuMzUiIGdyYWRpZW50VHJhbnNmb3JtPSJtYXRyaXgoMCAuMjk3MDIgLTMuODM5MSAtMS4xOTMxZS04IDI0MDguMSA4MzguODUpIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CjxzdG9wIHN0b3AtY29sb3I9IiNiYzczMTkiIG9mZnNldD0iMCIvPgo8c3RvcCBzdG9wLWNvbG9yPSIjZjBkMjYzIiBvZmZzZXQ9IjEiLz4KPC9yYWRpYWxHcmFkaWVudD4KPC9kZWZzPgo8bWV0YWRhdGE+CjxyZGY6UkRGPgo8Y2M6V29yayByZGY6YWJvdXQ9IiI+CjxkYzpmb3JtYXQ+aW1hZ2Uvc3ZnK3htbDwvZGM6Zm9ybWF0Pgo8ZGM6dHlwZSByZGY6cmVzb3VyY2U9Imh0dHA6Ly9wdXJsLm9yZy9kYy9kY21pdHlwZS9TdGlsbEltYWdlIi8+CjxkYzp0aXRsZS8+CjwvY2M6V29yaz4KPC9yZGY6UkRGPgo8L21ldGFkYXRhPgo8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgwIC05MjIuMzYpIj4KPHBhdGggZD0ibTE5Ny40NyA5ODcuMzZjMC0yNC4yODEtODcuMjYxLTYxLjcwOC04Ny4yNjEtNjEuNzA4djI5LjY5NGwtMTMuNTYzIDAuMzc5NGMtMTMuNTYzIDAuMzc5MzktNjIuMjAyIDIuODI3MS03NC44MTEgNy45NjU3LTEyLjYwOSA1LjEzODYtMTkuMzAxIDE0LjY5NS0xOS4zMDEgMjMuNjY5IDAgOC45NzM4IDMuOTczNSAxOC4xNjMgMTkuMzAxIDIzLjY2OSAxNS4zMjcgNS41MDU1IDYxLjI0OCA3LjU4NjMgNzQuODExIDcuOTY1N2wxMy41NjMgMC4zNzk0djI5LjY5NHM4Ny4yNjEtMzcuNDI4IDg3LjI2MS02MS43MDh6IiBmaWxsPSJ1cmwoI2EpIiBzdHJva2U9IiM3MzU1M2QiIHN0cm9rZS13aWR0aD0iMi42Mjg1Ii8+CjxnIHRyYW5zZm9ybT0ibWF0cml4KDAgLjI2Mjg1IC0uMjYyODUgMCAxNzguMTMgODYwLjAxKSIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjEwIj4KPGVsbGlwc2UgY3g9IjU0Ny4xNCIgY3k9IjEyMC45MyIgcng9IjI1LjcxNCIgcnk9IjUxLjQyOSIgZmlsbD0iI2ZmZiIvPgo8ZWxsaXBzZSBjeD0iNTM0LjM3IiBjeT0iMTIzLjUzIiByeD0iMTIuNjI3IiByeT0iMjYuMjY0Ii8+CjwvZz4KPGcgdHJhbnNmb3JtPSJtYXRyaXgoMCAtLjI2Mjg1IC0uMjYyODUgMCAxNzguNjYgMTExNC43KSIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjEwIj4KPGVsbGlwc2UgY3g9IjU0Ny4xNCIgY3k9IjEyMC45MyIgcng9IjI1LjcxNCIgcnk9IjUxLjQyOSIgZmlsbD0iI2ZmZiIvPgo8ZWxsaXBzZSBjeD0iNTM0LjM3IiBjeT0iMTIzLjUzIiByeD0iMTIuNjI3IiByeT0iMjYuMjY0Ii8+CjwvZz4KPC9nPgo8L3N2Zz4K";

	class DirectionArrow{
	    constructor(faceRight){
	        this.arrowImage = new Image();
	        this.arrowImage.src = explanarianArrowSVG;

	        this.arrowImage.classList.add("exp-arrow");

	        faceRight = faceRight===undefined ? true : faceRight;

	        if(faceRight){
	            this.arrowImage.classList.add("exp-arrow-right");
	        }else{
	            this.arrowImage.classList.add("exp-arrow-left");
	        }
	        this.arrowImage.onclick = (function(){
	            this.hideSelf();
	            this.onclickCallback();
	        }).bind(this);

	        this.onclickCallback = null; // to be set externally
	    }
	    showSelf(){
	        this.arrowImage.style.pointerEvents = '';
	        this.arrowImage.style.opacity = 1;
	        
	    }
	    hideSelf(){
	        this.arrowImage.style.opacity = 0;
	        this.arrowImage.style.pointerEvents = 'none';
	    }
	}


	class NonDecreasingDirector{
	    //Using a NonDecreasingDirector, create HTML elements with the 'exp-slide' class.
	    //The first HTML element with the 'exp-slide' class will be shown first. When the next slide button is clicked, that will fade out and be replaced with the next element with the exp-slide class, in order of HTML.
	    //If you want to display multiple HTML elements at the same time, 'exp-slide-<n>' will also be displayed when the presentation is currently on slide number n. For example, everything in the exp-slide-1 class will be visible from the start, and then exp-slide-2, and so on.
	    //Don't give an element both the exp-slide and exp-slide-n classes. 

	    // I want Director() to be able to backtrack by pressing backwards. This doesn't do that.
	    constructor(options){
	        this.slides = [];
	        this.currentSlideIndex = 0;        
	        this.numSlides = 0;
	        this.numHTMLSlides = 0;

	        this.nextSlideResolveFunction = null;
	        this.initialized = false;
	    }

	    


	    async begin(){
	        await this.waitForPageLoad();

	        this.setupAndHideAllSlideHTMLElements();

	        this.switchDisplayedSlideIndex(0); //unhide first one

	        this.setupClickables();

	        this.initialized = true;
	    }

	    setupAndHideAllSlideHTMLElements(){

	        this.slides = document.getElementsByClassName("exp-slide");
	        this.numHTMLSlides = this.slides.length;

	        //hide all slides except first one
	        for(var i=0;i<this.numHTMLSlides;i++){
	            this.slides[i].style.opacity = 0; 
	            this.slides[i].style.display = 'none';//opacity=0 alone won't be instant because of the 1s CSS transition
	        }
	        let self = this;
	        //undo setting display-none after a bit of time
	        window.setTimeout(function(){
	            for(var i=0;i<self.slides.length;i++){
	                self.slides[i].style.display = '';
	            }
	        },1);

	        //now handle exp-slide-<n>
	        let allSpecificSlideElements = document.querySelectorAll('[class*="exp-slide-"]'); //this is a CSS attribute selector, and I hate that this exists. it's so ugly
	        for(var i=0;i<allSpecificSlideElements.length;i++){
	            allSpecificSlideElements[i].style.opacity = 0; 
	            allSpecificSlideElements[i].style.display = 'none';//opacity=0 alone won't be instant because of the 1s CSS transition
	        }
	    }

	    setupClickables(){
	        let self = this;

	        this.rightArrow = new DirectionArrow();
	        document.body.appendChild(this.rightArrow.arrowImage);
	        this.rightArrow.onclickCallback = function(){
	            self._changeSlide(1, function(){}); // this errors without the empty function because there's no resolve. There must be a better way to do things.
	            console.warn("WARNING: Horrible hack in effect to change slides. Please replace the pass-an-empty-function thing with something that actually resolves properly and does async.");
	            self.nextSlideResolveFunction();
	        };

	    }

	    async waitForPageLoad(){
	        return new Promise(function(resolve, reject){
	            if(document.readyState == 'complete'){
	                resolve();
	            }
	            window.addEventListener("DOMContentLoaded",resolve);
	        });
	    }
	    async nextSlide(){
	        if(!this.initialized)throw new Error("ERROR: Use .begin() on a Director before calling any other methods!");

	        let self = this;

	        this.rightArrow.showSelf();
	        //promise is resolved by calling this.nextSlidePromise.resolve() when the time comes

	        return new Promise(function(resolve, reject){
	            function keyListener(e){
	                if(e.repeat)return; //keydown fires multiple times but we only want the first one
	                let slideDelta = 0;
	                switch (e.keyCode) {
	                  case 34:
	                  case 39:
	                  case 40:
	                    slideDelta = 1;
	                    break;
	                  default:
	                    break;
	                }
	                if(slideDelta != 0){
	                    self._changeSlide(slideDelta, resolve);
	                    self.rightArrow.hideSelf();
	                    window.removeEventListener("keydown",keyListener); //this approach taken from https://stackoverflow.com/questions/35718645/resolving-a-promise-with-eventlistener
	                }
	            }

	            window.addEventListener("keydown", keyListener);
	            //horrible hack so that the 'next slide' arrow can trigger this too
	            self.nextSlideResolveFunction = function(){ 
	                resolve();
	                window.removeEventListener("keydown",keyListener); 
	            };
	        });
	    }
	    _changeSlide(slideDelta, resolve){
	        //slide changing logic
	        if(slideDelta != 0){
	            if(this.currentSlideIndex == 0 && slideDelta == -1){
	                return; //no going past the beginning
	            }
	            if(this.currentSlideIndex == this.numHTMLSlides-1 && slideDelta == 1){
	                return; //no going past the end
	            }

	            this.switchDisplayedSlideIndex(this.currentSlideIndex + slideDelta);
	            resolve();
	        }
	    }

	    switchDisplayedSlideIndex(slideNumber){
	        //updates HTML and also sets this.currentSlideIndex to slideNumber

	        let prevSlideNumber = this.currentSlideIndex;
	        this.currentSlideIndex = slideNumber;


	        //hide the HTML elements for the previous slide

	        //items with class exp-slide
	        if(prevSlideNumber < this.slides.length){
	            this.slides[prevSlideNumber].style.opacity = 0;
	        }
	        
	        //items with HTML class exp-slide-n
	        let prevSlideElems = document.getElementsByClassName("exp-slide-"+(prevSlideNumber+1));
	        for(var i=0;i<prevSlideElems.length;i++){
	            prevSlideElems[i].style.opacity = 0;
	        }


	        //show the HTML elements for the current slide
	  
	        
	        //items with HTML class exp-slide-n
	        let elemsToDisplayOnlyOnThisSlide = document.getElementsByClassName("exp-slide-"+(slideNumber+1));

	        if(slideNumber >= this.numHTMLSlides && elemsToDisplayOnlyOnThisSlide.length == 0){
	            console.error("Tried to show slide #"+slideNumber+", but only " + this.numHTMLSlides + "HTML elements with exp-slide were found! Make more slides?");
	            return;
	        }

	        for(var i=0;i<elemsToDisplayOnlyOnThisSlide.length;i++){
	            elemsToDisplayOnlyOnThisSlide[i].style.opacity = 1;
	        }

	        //items with class exp-slide
	        if(slideNumber < this.slides.length){
	            this.slides[slideNumber].style.opacity = 1;
	        }

	    }

	    //verbs
	    async delay(waitTime){
	        return new Promise(function(resolve, reject){
	            window.setTimeout(resolve, waitTime);
	        });
	    }
	    TransitionTo(target, toValues, durationMS){
	        //Utils.Assert(this.undoStackIndex == 0); //This may not work well.
	        new Animation(target, toValues, durationMS === undefined ? undefined : durationMS/1000);
	    }
	}







	class UndoCapableDirector extends NonDecreasingDirector{
	    //thsi director uses both forwards and backwards arrows. the backwards arrow will undo any UndoCapableDirector.TransitionTo()s
	    //todo: hook up the arrows and make it not
	    constructor(options){
	        super(options);

	        this.furthestSlideIndex = 0; //matches the number of times nextSlide() has been called
	        //this.currentSlideIndex is always < this.furthestSlideIndex - if equal, we release the promise and let nextSlide() return

	        this.undoStack = [];
	        this.undoStackIndex = 0; //increased by one every time either this.TransitionTo is called or this.nextSlide() is called

	        let self = this;

	        //if you press right before the first director.nextSlide(), don't error
	        this.nextSlideResolveFunction = function(){}; 

	        function keyListener(e){
	            if(e.repeat)return; //keydown fires multiple times but we only want the first one
	            switch (e.keyCode) {
	              case 34:
	              case 39:
	              case 40:
	                self.handleForwardsPress();
	                break;
	              case 33:
	              case 37:
	              case 38:
	                self.handleBackwardsPress();
	              default:
	                break;
	            }
	        }

	        window.addEventListener("keydown", keyListener);
	    }

	    setupClickables(){
	        let self = this;

	        this.leftArrow = new DirectionArrow(false);
	        this.leftArrow.hideSelf();
	        document.body.appendChild(this.leftArrow.arrowImage);
	        this.leftArrow.onclickCallback = function(){
	            self.handleBackwardsPress();
	        };

	        this.rightArrow = new DirectionArrow(true);
	        document.body.appendChild(this.rightArrow.arrowImage);
	        this.rightArrow.onclickCallback = function(){
	            self.handleForwardsPress();
	        };
	    }

	    moveFurtherIntoPresentation(){
	            //if there's nothing to redo, (so we're not in the past of the undo stack), advance further.
	            //if there are less HTML slides than calls to director.newSlide(), complain in the console but allow the presentation to proceed
	            if(this.currentSlideIndex < this.numSlides){
	                this.undoStackIndex += 1; //advance past the NewSlideUndoItem
	                this.furthestSlideIndex += 1; 

	                this.switchDisplayedSlideIndex(this.currentSlideIndex + 1); //this will complain in the console window if there are less slides than newSlide() calls
	                this.showArrows(); //showArrows must come after this.currentSlideIndex advances or else we won't be able to tell if we're at the end or not
	            }
	            this.nextSlideResolveFunction(); //allow presentation code to proceed
	    }

	    handleForwardsPress(){
	        this.rightArrow.hideSelf();

	        if(this.furthestSlideIndex == this.currentSlideIndex){
	            //if nothing to redo
	            this.moveFurtherIntoPresentation();
	            return;
	        }
	        // if we get to here, we've previously done an undo and we need to catch up

	        if(this.undoStackIndex < this.undoStack.length-1) this.undoStackIndex += 1;

	        while(this.undoStack[this.undoStackIndex].constructor !== NewSlideUndoItem){
	            //loop through undo stack and redo each undo

	            let redoItem = this.undoStack[this.undoStackIndex];
	            switch(redoItem.type){
	                case DELAY:
	                    //while redoing, skip any delays
	                    break;
	                case TRANSITIONTO:
	                    var redoAnimation = new Animation(redoItem.target, redoItem.toValues, redoItem.durationMS === undefined ? undefined : redoItem.durationMS/1000);
	                  //and now redoAnimation, having been created, goes off and does its own thing I guess. this seems inefficient. todo: fix that and make them all centrally updated by the animation loop orsomething
	                    break;
	                case NEWSLIDE:
	                    break;
	                default:
	                    break;
	            }

	            if(this.undoStackIndex == this.undoStack.length-1){
	                //fully redone and at current slide
	                break;
	            }
	            
	            this.undoStackIndex += 1;

	        }
	        this.switchDisplayedSlideIndex(this.currentSlideIndex + 1);
	        this.showArrows();
	    }

	    handleBackwardsPress(){
	        this.leftArrow.hideSelf();

	        if(this.undoStackIndex == 0 || this.currentSlideIndex == 0){
	            return;
	        }

	        this.undoStackIndex -= 1;
	        while(this.undoStack[this.undoStackIndex].constructor !== NewSlideUndoItem){
	            //loop through undo stack and redo each undo

	            if(this.undoStackIndex == 0){
	                //at first slide
	                break;
	            }

	            //undo transformation in this.undoStack[this.undoStackIndex]
	            let undoItem = this.undoStack[this.undoStackIndex];
	            switch(undoItem.type){
	                case DELAY:
	                    //while undoing, skip any delays
	                    break;
	                case TRANSITIONTO:
	                    let duration = undoItem.durationMS === undefined ? 1 : undoItem.durationMS/1000;
	                    duration = Math.min(duration / 2, 1); //undoing should be faster, so cut it in half - but cap durations at 1s
	                    var undoAnimation = new Animation(undoItem.target, undoItem.fromValues, duration);
	                    //and now undoAnimation, having been created, goes off and does its own thing I guess. this seems inefficient. todo: fix that and make them all centrally updated by the animation loop orsomething
	                    break;
	                case NEWSLIDE:
	                    break;
	                default:
	                    break;
	            }
	            this.undoStackIndex -= 1;
	        }
	        this.switchDisplayedSlideIndex(this.currentSlideIndex - 1);
	        this.showArrows();
	    }

	    showArrows(){
	        if(this.currentSlideIndex > 0){
	            this.leftArrow.showSelf();
	        }else{
	            this.leftArrow.hideSelf();
	        }
	        if(this.currentSlideIndex < this.numSlides){
	            this.rightArrow.showSelf();
	        }else{
	            this.rightArrow.hideSelf();
	        }
	    }

	    async nextSlide(){
	        /*The user will call this function to mark the transition between one slide and the next. This does two things:
	        A) waits until the user presses the right arrow key, returns, and continues execution until the next nextSlide() call
	        B) if the user presses the left arrow key, they can undo and go back in time, and every TransitionTo() call before that will be undone until it reaches a previous nextSlide() call. Any normal javascript assignments won't be caught in this :(
	        C) if undo
	        */
	        if(!this.initialized)throw new Error("ERROR: Use .begin() on a Director before calling any other methods!");

	        
	        this.numSlides++;
	        this.undoStack.push(new NewSlideUndoItem(this.currentSlideIndex));
	        this.showArrows();


	        let self = this;

	        //promise is resolved by calling this.nextSlideResolveFunction() when the time comes
	        return new Promise(function(resolve, reject){
	            self.nextSlideResolveFunction = function(){ 
	                resolve();
	            };
	        });

	    }

	    async delay(waitTime){
	        this.undoStack.push(new DelayUndoItem(waitTime));
	        this.undoStackIndex++;
	        await super.delay(waitTime);
	    }
	    TransitionTo(target, toValues, durationMS){
	        var animation = new Animation(target, toValues, durationMS === undefined ? undefined : durationMS/1000);
	        let fromValues = animation.fromValues;
	        this.undoStack.push(new UndoItem(target, toValues, fromValues, durationMS));
	        this.undoStackIndex++;
	    }
	}


	//discount enum
	const TRANSITIONTO = 0;
	const NEWSLIDE = 1;
	const DELAY=2;

	//things that can be stored in a UndoCapableDirector's .undoStack[]
	class UndoItem{
	    constructor(target, toValues, fromValues, durationMS){
	        this.target = target;
	        this.toValues = toValues;
	        this.fromValues = fromValues;
	        this.durationMS = durationMS;
	        this.type = TRANSITIONTO;
	    }
	}

	class NewSlideUndoItem{
	    constructor(slideIndex){
	        this.slideIndex = slideIndex;
	        this.type = NEWSLIDE;
	    }
	}

	class DelayUndoItem{
	    constructor(waitTime){
	        this.waitTime = waitTime;
	        this.type = DELAY;
	    }
	}

	exports.Transformation = Transformation;
	exports.setupThree = setupThree;
	exports.ThreeasyEnvironment = ThreeasyEnvironment;
	exports.ThreeasyRecorder = ThreeasyRecorder;
	exports.Utils = Utils;
	exports.Math = Math$1;
	exports.Array = EXPArray;
	exports.Area = Area;
	exports.HistoryRecorder = HistoryRecorder;
	exports.TransitionTo = TransitionTo;
	exports.Animation = Animation;
	exports.delay = delay;
	exports.LineOutput = LineOutput;
	exports.PointOutput = PointOutput;
	exports.PointMesh = PointMesh;
	exports.VectorOutput = VectorOutput;
	exports.SurfaceOutput = SurfaceOutput;
	exports.FlatArrayOutput = FlatArrayOutput;
	exports.NonDecreasingDirector = NonDecreasingDirector;
	exports.DirectionArrow = DirectionArrow;
	exports.UndoCapableDirector = UndoCapableDirector;

	Object.defineProperty(exports, '__esModule', { value: true });

}));
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhwbGFuYXJpYS1idW5kbGUuanMiLCJzb3VyY2VzIjpbIi4uL3NyYy9qcy9Ob2RlLmpzIiwiLi4vc3JjL2pzL0FycmF5LmpzIiwiLi4vc3JjL2pzL21hdGguanMiLCIuLi9zcmMvanMvdXRpbHMuanMiLCIuLi9zcmMvanMvQXJlYS5qcyIsIi4uL3NyYy9qcy9UcmFuc2Zvcm1hdGlvbi5qcyIsIi4uL3NyYy9qcy9IaXN0b3J5UmVjb3JkZXIuanMiLCIuLi9zcmMvanMvVGhyZWVFbnZpcm9ubWVudC5qcyIsIi4uL3NyYy9qcy9BbmltYXRpb24uanMiLCIuLi9ub2RlX21vZHVsZXMvY2NhcHR1cmUuanMvc3JjL3Rhci5qcyIsIi4uL25vZGVfbW9kdWxlcy9jY2FwdHVyZS5qcy9zcmMvZG93bmxvYWQuanMiLCIuLi9ub2RlX21vZHVsZXMvY2NhcHR1cmUuanMvc3JjL2dpZi5qcyIsIi4uL25vZGVfbW9kdWxlcy9jY2FwdHVyZS5qcy9zcmMvQ0NhcHR1cmUuanMiLCIuLi9zcmMvbGliL1dlYkdMX0RldGVjdG9yLmpzIiwiLi4vc3JjL2pzL3RocmVlX2Jvb3RzdHJhcC5qcyIsIi4uL3NyYy9qcy9hc3luY0RlbGF5RnVuY3Rpb25zLmpzIiwiLi4vc3JjL2pzL291dHB1dHMvTGluZU91dHB1dFNoYWRlcnMuanMiLCIuLi9zcmMvanMvb3V0cHV0cy9MaW5lT3V0cHV0LmpzIiwiLi4vc3JjL2pzL291dHB1dHMvUG9pbnRPdXRwdXQuanMiLCIuLi9zcmMvanMvb3V0cHV0cy9WZWN0b3JPdXRwdXQuanMiLCIuLi9zcmMvanMvb3V0cHV0cy9TdXJmYWNlT3V0cHV0U2hhZGVycy5qcyIsIi4uL3NyYy9qcy9vdXRwdXRzL1N1cmZhY2VPdXRwdXQuanMiLCIuLi9zcmMvanMvb3V0cHV0cy9GbGF0QXJyYXlPdXRwdXQuanMiLCIuLi9zcmMvanMvRGlyZWN0b3JJbWFnZUNvbnN0YW50cy5qcyIsIi4uL3NyYy9qcy9EaXJlY3Rvci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKiBUaGUgYmFzZSBjbGFzcyB0aGF0IGV2ZXJ5dGhpbmcgaW5oZXJpdHMgZnJvbS4gXG5cdEVhY2ggdGhpbmcgZHJhd24gdG8gdGhlIHNjcmVlbiBpcyBhIHRyZWUuIERvbWFpbnMsIHN1Y2ggYXMgRVhQLkFyZWEgb3IgRVhQLkFycmF5IGFyZSB0aGUgcm9vdCBub2Rlcyxcblx0RVhQLlRyYW5zZm9ybWF0aW9uIGlzIGN1cnJlbnRseSB0aGUgb25seSBpbnRlcm1lZGlhdGUgbm9kZSwgYW5kIHRoZSBsZWFmIG5vZGVzIGFyZSBzb21lIGZvcm0gb2YgT3V0cHV0IHN1Y2ggYXNcblx0RVhQLkxpbmVPdXRwdXQgb3IgRVhQLlBvaW50T3V0cHV0LCBvciBFWFAuVmVjdG9yT3V0cHV0LlxuXG5cdEFsbCBvZiB0aGVzZSBjYW4gYmUgLmFkZCgpZWQgdG8gZWFjaCBvdGhlciB0byBmb3JtIHRoYXQgdHJlZSwgYW5kIHRoaXMgZmlsZSBkZWZpbmVzIGhvdyBpdCB3b3Jrcy5cbiovXG5cbmNsYXNzIE5vZGV7XG5cdGNvbnN0cnVjdG9yKCl7ICAgICAgICBcblx0XHR0aGlzLmNoaWxkcmVuID0gW107XG5cdFx0dGhpcy5wYXJlbnQgPSBudWxsOyAgICAgICAgXG4gICAgfVxuXHRhZGQodGhpbmcpe1xuXHRcdC8vY2hhaW5hYmxlIHNvIHlvdSBjYW4gYS5hZGQoYikuYWRkKGMpIHRvIG1ha2UgYS0+Yi0+Y1xuXHRcdHRoaXMuY2hpbGRyZW4ucHVzaCh0aGluZyk7XG5cdFx0dGhpbmcucGFyZW50ID0gdGhpcztcblx0XHRpZih0aGluZy5fb25BZGQpdGhpbmcuX29uQWRkKCk7XG5cdFx0cmV0dXJuIHRoaW5nO1xuXHR9XG5cdF9vbkFkZCgpe31cblx0cmVtb3ZlKHRoaW5nKXtcblx0XHR2YXIgaW5kZXggPSB0aGlzLmNoaWxkcmVuLmluZGV4T2YoIHRoaW5nICk7XG5cdFx0aWYgKCBpbmRleCAhPT0gLSAxICkge1xuXHRcdFx0dGhpbmcucGFyZW50ID0gbnVsbDtcblx0XHRcdHRoaXMuY2hpbGRyZW4uc3BsaWNlKCBpbmRleCwgMSApO1xuXHRcdH1cblx0XHRyZXR1cm4gdGhpcztcblx0fVxuICAgIGdldFRvcFBhcmVudCgpeyAvL2ZpbmQgdGhlIHBhcmVudCBvZiB0aGUgcGFyZW50IG9mIHRoZS4uLiB1bnRpbCB0aGVyZSdzIG5vIG1vcmUgcGFyZW50cy5cbiAgICAgICAgY29uc3QgTUFYX0NIQUlOID0gMTAwO1xuICAgICAgICBsZXQgcGFyZW50Q291bnQgPSAwO1xuXHRcdGxldCByb290ID0gdGhpcztcblx0XHR3aGlsZShyb290ICE9PSBudWxsICYmIHJvb3QucGFyZW50ICE9PSBudWxsICYmIHBhcmVudENvdW50IDwgTUFYX0NIQUlOKXtcblx0XHRcdHJvb3QgPSByb290LnBhcmVudDtcbiAgICAgICAgICAgIHBhcmVudENvdW50Kz0gMTtcblx0XHR9XG5cdFx0aWYocGFyZW50Q291bnQgPj0gTUFYX0NIQUlOKXRocm93IG5ldyBFcnJvcihcIlVuYWJsZSB0byBmaW5kIHRvcC1sZXZlbCBwYXJlbnQhXCIpO1xuICAgICAgICByZXR1cm4gcm9vdDtcbiAgICB9XG4gICAgZ2V0RGVlcGVzdENoaWxkcmVuKCl7IC8vZmluZCBhbGwgbGVhZiBub2RlcyBmcm9tIHRoaXMgbm9kZVxuICAgICAgICAvL3RoaXMgYWxnb3JpdGhtIGNhbiBwcm9iYWJseSBiZSBpbXByb3ZlZFxuICAgICAgICBpZih0aGlzLmNoaWxkcmVuLmxlbmd0aCA9PSAwKXJldHVybiBbdGhpc107XG5cbiAgICAgICAgbGV0IGNoaWxkcmVuID0gW107XG4gICAgICAgIGZvcihsZXQgaT0wO2k8dGhpcy5jaGlsZHJlbi5sZW5ndGg7aSsrKXtcbiAgICAgICAgICAgIGxldCBjaGlsZHNDaGlsZHJlbiA9IHRoaXMuY2hpbGRyZW5baV0uZ2V0RGVlcGVzdENoaWxkcmVuKCk7XG4gICAgICAgICAgICBmb3IobGV0IGo9MDtqPGNoaWxkc0NoaWxkcmVuLmxlbmd0aDtqKyspe1xuICAgICAgICAgICAgICAgIGNoaWxkcmVuLnB1c2goY2hpbGRzQ2hpbGRyZW5bal0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBjaGlsZHJlbjtcbiAgICB9XG4gICAgZ2V0Q2xvc2VzdERvbWFpbigpe1xuICAgICAgICAvKiBGaW5kIHRoZSBEb21haW5Ob2RlIHRoYXQgdGhpcyBOb2RlIGlzIGJlaW5nIGNhbGxlZCBmcm9tLlxuICAgICAgICBUcmF2ZXJzZSB0aGUgY2hhaW4gb2YgcGFyZW50cyB1cHdhcmRzIHVudGlsIHdlIGZpbmQgYSBEb21haW5Ob2RlLCBhdCB3aGljaCBwb2ludCB3ZSByZXR1cm4gaXQuXG4gICAgICAgIFRoaXMgYWxsb3dzIGFuIG91dHB1dCB0byByZXNpemUgYW4gYXJyYXkgdG8gbWF0Y2ggYSBkb21haW5Ob2RlJ3MgbnVtQ2FsbHNQZXJBY3RpdmF0aW9uLCBmb3IgZXhhbXBsZS5cblxuICAgICAgICBOb3RlIHRoYXQgdGhpcyByZXR1cm5zIHRoZSBNT1NUIFJFQ0VOVCBEb21haW5Ob2RlIGFuY2VzdG9yIC0gaXQncyBhc3N1bWVkIHRoYXQgZG9tYWlubm9kZXMgb3ZlcndyaXRlIG9uZSBhbm90aGVyLlxuICAgICAgICAqL1xuICAgICAgICBjb25zdCBNQVhfQ0hBSU4gPSAxMDA7XG4gICAgICAgIGxldCBwYXJlbnRDb3VudCA9IDA7XG5cdFx0bGV0IHJvb3QgPSB0aGlzLnBhcmVudDsgLy9zdGFydCBvbmUgbGV2ZWwgdXAgaW4gY2FzZSB0aGlzIGlzIGEgRG9tYWluTm9kZSBhbHJlYWR5LiB3ZSBkb24ndCB3YW50IHRoYXRcblx0XHR3aGlsZShyb290ICE9PSBudWxsICYmIHJvb3QucGFyZW50ICE9PSBudWxsICYmICFyb290LmlzRG9tYWluTm9kZSAmJiBwYXJlbnRDb3VudCA8IE1BWF9DSEFJTil7XG5cdFx0XHRyb290ID0gcm9vdC5wYXJlbnQ7XG4gICAgICAgICAgICBwYXJlbnRDb3VudCs9IDE7XG5cdFx0fVxuXHRcdGlmKHBhcmVudENvdW50ID49IE1BWF9DSEFJTil0aHJvdyBuZXcgRXJyb3IoXCJVbmFibGUgdG8gZmluZCBwYXJlbnQhXCIpO1xuICAgICAgICBpZihyb290ID09PSBudWxsIHx8ICFyb290LmlzRG9tYWluTm9kZSl0aHJvdyBuZXcgRXJyb3IoXCJObyBEb21haW5Ob2RlIHBhcmVudCBmb3VuZCFcIik7XG4gICAgICAgIHJldHVybiByb290O1xuICAgIH1cblxuXHRvbkFmdGVyQWN0aXZhdGlvbigpe1xuXHRcdC8vIGRvIG5vdGhpbmdcblx0XHQvL2J1dCBjYWxsIGFsbCBjaGlsZHJlblxuXHRcdGZvcih2YXIgaT0wO2k8dGhpcy5jaGlsZHJlbi5sZW5ndGg7aSsrKXtcblx0XHRcdHRoaXMuY2hpbGRyZW5baV0ub25BZnRlckFjdGl2YXRpb24oKTtcblx0XHR9XG5cdH1cbn1cblxuY2xhc3MgT3V0cHV0Tm9kZSBleHRlbmRzIE5vZGV7IC8vbW9yZSBvZiBhIGphdmEgaW50ZXJmYWNlLCByZWFsbHlcblx0Y29uc3RydWN0b3IoKXtzdXBlcigpO31cblx0ZXZhbHVhdGVTZWxmKGksIHQsIHgsIHksIHope31cblx0b25BZnRlckFjdGl2YXRpb24oKXt9XG5cdF9vbkFkZCgpe31cbn1cblxuY2xhc3MgRG9tYWluTm9kZSBleHRlbmRzIE5vZGV7IC8vQSBub2RlIHRoYXQgY2FsbHMgb3RoZXIgZnVuY3Rpb25zIG92ZXIgc29tZSByYW5nZS5cblx0Y29uc3RydWN0b3IoKXtcbiAgICAgICAgc3VwZXIoKTtcblx0XHR0aGlzLml0ZW1EaW1lbnNpb25zID0gW107IC8vIGFycmF5IHRvIHN0b3JlIHRoZSBudW1iZXIgb2YgdGltZXMgdGhpcyBpcyBjYWxsZWQgcGVyIGRpbWVuc2lvbi5cbiAgICAgICAgdGhpcy5udW1DYWxsc1BlckFjdGl2YXRpb24gPSBudWxsOyAvLyBudW1iZXIgb2YgdGltZXMgYW55IGNoaWxkIG5vZGUncyBldmFsdWF0ZVNlbGYoKSBpcyBjYWxsZWRcbiAgICB9XG4gICAgYWN0aXZhdGUodCl7fVxufVxuRG9tYWluTm9kZS5wcm90b3R5cGUuaXNEb21haW5Ob2RlID0gdHJ1ZTtcblxuZXhwb3J0IGRlZmF1bHQgTm9kZTtcbmV4cG9ydCB7T3V0cHV0Tm9kZSwgRG9tYWluTm9kZX07XG4iLCJcInVzZSBzdHJpY3RcIjtcblxuaW1wb3J0IHsgRG9tYWluTm9kZSB9ICBmcm9tICcuL05vZGUuanMnO1xuLy90ZXN0Pz9cbmNsYXNzIEVYUEFycmF5IGV4dGVuZHMgRG9tYWluTm9kZXtcblx0Y29uc3RydWN0b3Iob3B0aW9ucyl7XG5cdFx0c3VwZXIoKTtcblx0XHQvKnZhciBwb2ludHMgPSBuZXcgRVhQLkFycmF5KHtcblx0XHRkYXRhOiBbWy0xMCwxMF0sXG5cdFx0XHRbMTAsMTBdXVxuXHRcdH0pKi9cblxuXHRcdEVYUC5VdGlscy5hc3NlcnRQcm9wRXhpc3RzKG9wdGlvbnMsIFwiZGF0YVwiKTsgLy8gYSBtdWx0aWRpbWVuc2lvbmFsIGFycmF5LiBhc3N1bWVkIHRvIG9ubHkgY29udGFpbiBvbmUgdHlwZTogZWl0aGVyIG51bWJlcnMgb3IgYXJyYXlzXG5cdFx0RVhQLlV0aWxzLmFzc2VydFR5cGUob3B0aW9ucy5kYXRhLCBBcnJheSk7XG5cblx0XHQvL0l0J3MgYXNzdW1lZCBhbiBFWFAuQXJyYXkgd2lsbCBvbmx5IHN0b3JlIHRoaW5ncyBzdWNoIGFzIDAsIFswXSwgWzAsMF0gb3IgWzAsMCwwXS4gSWYgYW4gYXJyYXkgdHlwZSBpcyBzdG9yZWQsIHRoaXMuYXJyYXlUeXBlRGltZW5zaW9ucyBjb250YWlucyB0aGUgLmxlbmd0aCBvZiB0aGF0IGFycmF5LiBPdGhlcndpc2UgaXQncyAwLCBiZWNhdXNlIHBvaW50cyBhcmUgMC1kaW1lbnNpb25hbC5cblx0XHRpZihvcHRpb25zLmRhdGFbMF0uY29uc3RydWN0b3IgPT09IE51bWJlcil7XG5cdFx0XHR0aGlzLmFycmF5VHlwZURpbWVuc2lvbnMgPSAwO1xuXHRcdH1lbHNlIGlmKG9wdGlvbnMuZGF0YVswXS5jb25zdHJ1Y3RvciA9PT0gQXJyYXkpe1xuXHRcdFx0dGhpcy5hcnJheVR5cGVEaW1lbnNpb25zID0gb3B0aW9ucy5kYXRhWzBdLmxlbmd0aDtcblx0XHR9ZWxzZXtcblx0XHRcdGNvbnNvbGUuZXJyb3IoXCJEYXRhIGluIGFuIEVYUC5BcnJheSBzaG91bGQgYmUgYSBudW1iZXIgb3IgYW4gYXJyYXkgb2Ygb3RoZXIgdGhpbmdzLCBub3QgXCIgKyBvcHRpb25zLmRhdGFbMF0uY29uc3RydWN0b3IpO1xuXHRcdH1cblxuXG5cdFx0RVhQLlV0aWxzLmFzc2VydChvcHRpb25zLmRhdGFbMF0ubGVuZ3RoICE9IDApOyAvL2Rvbid0IGFjY2VwdCBbW11dLCBkYXRhIG5lZWRzIHRvIGJlIHNvbWV0aGluZyBsaWtlIFtbMSwyXV0uXG5cblx0XHR0aGlzLmRhdGEgPSBvcHRpb25zLmRhdGE7XG5cdFx0dGhpcy5udW1JdGVtcyA9IHRoaXMuZGF0YS5sZW5ndGg7XG5cblx0XHR0aGlzLml0ZW1EaW1lbnNpb25zID0gW3RoaXMuZGF0YS5sZW5ndGhdOyAvLyBhcnJheSB0byBzdG9yZSB0aGUgbnVtYmVyIG9mIHRpbWVzIHRoaXMgaXMgY2FsbGVkIHBlciBkaW1lbnNpb24uXG5cblx0XHQvL3RoZSBudW1iZXIgb2YgdGltZXMgZXZlcnkgY2hpbGQncyBleHByIGlzIGNhbGxlZFxuXHRcdHRoaXMubnVtQ2FsbHNQZXJBY3RpdmF0aW9uID0gdGhpcy5pdGVtRGltZW5zaW9ucy5yZWR1Y2UoKHN1bSx5KT0+c3VtKnkpO1xuXHR9XG5cdGFjdGl2YXRlKHQpe1xuXHRcdGlmKHRoaXMuYXJyYXlUeXBlRGltZW5zaW9ucyA9PSAwKXtcblx0XHRcdC8vbnVtYmVycyBjYW4ndCBiZSBzcHJlYWQgdXNpbmcgLi4uIG9wZXJhdG9yXG5cdFx0XHRmb3IodmFyIGk9MDtpPHRoaXMuZGF0YS5sZW5ndGg7aSsrKXtcblx0XHRcdFx0dGhpcy5fY2FsbEFsbENoaWxkcmVuKGksdCx0aGlzLmRhdGFbaV0pO1xuXHRcdFx0fVxuXHRcdH1lbHNle1xuXHRcdFx0Zm9yKHZhciBpPTA7aTx0aGlzLmRhdGEubGVuZ3RoO2krKyl7XG5cdFx0XHRcdHRoaXMuX2NhbGxBbGxDaGlsZHJlbihpLHQsLi4udGhpcy5kYXRhW2ldKTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHR0aGlzLm9uQWZ0ZXJBY3RpdmF0aW9uKCk7IC8vIGNhbGwgY2hpbGRyZW4gaWYgbmVjZXNzYXJ5XG5cdH1cblx0X2NhbGxBbGxDaGlsZHJlbiguLi5jb29yZGluYXRlcyl7XG5cdFx0Zm9yKHZhciBpPTA7aTx0aGlzLmNoaWxkcmVuLmxlbmd0aDtpKyspe1xuXHRcdFx0dGhpcy5jaGlsZHJlbltpXS5ldmFsdWF0ZVNlbGYoLi4uY29vcmRpbmF0ZXMpXG5cdFx0fVxuXHR9XG5cdGNsb25lKCl7XG5cdFx0bGV0IGNsb25lID0gbmV3IEVYUC5BcnJheSh7ZGF0YTogRVhQLlV0aWxzLmFycmF5Q29weSh0aGlzLmRhdGEpfSk7XG5cdFx0Zm9yKHZhciBpPTA7aTx0aGlzLmNoaWxkcmVuLmxlbmd0aDtpKyspe1xuXHRcdFx0Y2xvbmUuYWRkKHRoaXMuY2hpbGRyZW5baV0uY2xvbmUoKSk7XG5cdFx0fVxuXHRcdHJldHVybiBjbG9uZTtcblx0fVxufVxuXG5cbi8vdGVzdGluZyBjb2RlXG5mdW5jdGlvbiB0ZXN0QXJyYXkoKXtcblx0dmFyIHggPSBuZXcgRVhQLkFycmF5KHtkYXRhOiBbWzAsMV0sWzAsMV1dfSk7XG5cdHZhciB5ID0gbmV3IEVYUC5UcmFuc2Zvcm1hdGlvbih7ZXhwcjogZnVuY3Rpb24oLi4uYSl7Y29uc29sZS5sb2coLi4uYSk7IHJldHVybiBbMl19fSk7XG5cdHguYWRkKHkpO1xuXHR4LmFjdGl2YXRlKDUxMik7XG59XG5cbmV4cG9ydCB7RVhQQXJyYXkgYXMgQXJyYXl9O1xuIiwiZnVuY3Rpb24gbXVsdGlwbHlTY2FsYXIoYywgYXJyYXkpe1xuXHRmb3IodmFyIGk9MDtpPGFycmF5Lmxlbmd0aDtpKyspe1xuXHRcdGFycmF5W2ldICo9IGM7XG5cdH1cblx0cmV0dXJuIGFycmF5XG59XG5mdW5jdGlvbiB2ZWN0b3JBZGQodjEsdjIpe1xuICAgIGxldCB2ZWMgPSBjbG9uZSh2MSk7XG5cdGZvcih2YXIgaT0wO2k8djEubGVuZ3RoO2krKyl7XG5cdFx0dmVjW2ldICs9IHYyW2ldO1xuXHR9XG5cdHJldHVybiB2ZWNcbn1cbmZ1bmN0aW9uIGxlcnBWZWN0b3JzKHQsIHAxLCBwMil7XG5cdC8vYXNzdW1lZCB0IGluIFswLDFdXG5cdHJldHVybiB2ZWN0b3JBZGQobXVsdGlwbHlTY2FsYXIodCxjbG9uZShwMSkpLG11bHRpcGx5U2NhbGFyKDEtdCxjbG9uZShwMikpKTtcbn1cbmZ1bmN0aW9uIGNsb25lKHZlYyl7XG5cdHZhciBuZXdBcnIgPSBuZXcgQXJyYXkodmVjLmxlbmd0aCk7XG5cdGZvcih2YXIgaT0wO2k8dmVjLmxlbmd0aDtpKyspe1xuXHRcdG5ld0FycltpXSA9IHZlY1tpXTtcblx0fVxuXHRyZXR1cm4gbmV3QXJyXG59XG5mdW5jdGlvbiBtdWx0aXBseU1hdHJpeCh2ZWMsIG1hdHJpeCl7XG5cdC8vYXNzZXJ0IHZlYy5sZW5ndGggPT0gbnVtUm93c1xuXG5cdGxldCBudW1Sb3dzID0gbWF0cml4Lmxlbmd0aDtcblx0bGV0IG51bUNvbHMgPSBtYXRyaXhbMF0ubGVuZ3RoO1xuXG5cdHZhciBvdXRwdXQgPSBuZXcgQXJyYXkobnVtQ29scyk7XG5cdGZvcih2YXIgaj0wO2o8bnVtQ29scztqKyspe1xuXHRcdG91dHB1dFtqXSA9IDA7XG5cdFx0Zm9yKHZhciBpPTA7aTxudW1Sb3dzO2krKyl7XG5cdFx0XHRvdXRwdXRbal0gKz0gbWF0cml4W2ldW2pdICogdmVjW2ldO1xuXHRcdH1cblx0fVxuXHRyZXR1cm4gb3V0cHV0O1xufVxuXG4vL2hhY2tcbmxldCBNYXRoID0ge2Nsb25lOiBjbG9uZSwgbGVycFZlY3RvcnM6IGxlcnBWZWN0b3JzLCB2ZWN0b3JBZGQ6IHZlY3RvckFkZCwgbXVsdGlwbHlTY2FsYXI6IG11bHRpcGx5U2NhbGFyLCBtdWx0aXBseU1hdHJpeDogbXVsdGlwbHlNYXRyaXh9O1xuXG5leHBvcnQge3ZlY3RvckFkZCwgbGVycFZlY3RvcnMsIGNsb25lLCBtdWx0aXBseVNjYWxhciwgbXVsdGlwbHlNYXRyaXgsIE1hdGh9O1xuIiwiaW1wb3J0IHtjbG9uZX0gZnJvbSAnLi9tYXRoLmpzJ1xuXG5jbGFzcyBVdGlsc3tcblxuXHRzdGF0aWMgaXNBcnJheSh4KXtcblx0XHRyZXR1cm4geC5jb25zdHJ1Y3RvciA9PT0gQXJyYXk7XG5cdH1cblx0c3RhdGljIGFycmF5Q29weSh4KXtcblx0XHRyZXR1cm4geC5zbGljZSgpO1xuXHR9XG5cdHN0YXRpYyBpc0Z1bmN0aW9uKHgpe1xuXHRcdHJldHVybiB4LmNvbnN0cnVjdG9yID09PSBGdW5jdGlvbjtcblx0fVxuXG5cdHN0YXRpYyBhc3NlcnQodGhpbmcpe1xuXHRcdC8vQSBmdW5jdGlvbiB0byBjaGVjayBpZiBzb21ldGhpbmcgaXMgdHJ1ZSBhbmQgaGFsdCBvdGhlcndpc2UgaW4gYSBjYWxsYmFja2FibGUgd2F5LlxuXHRcdGlmKCF0aGluZyl7XG5cdFx0XHRjb25zb2xlLmVycm9yKFwiRVJST1IhIEFzc2VydGlvbiBmYWlsZWQuIFNlZSB0cmFjZWJhY2sgZm9yIG1vcmUuXCIpO1xuICAgICAgICAgICAgY29uc29sZS50cmFjZSgpO1xuXHRcdH1cblx0fVxuXG5cdHN0YXRpYyBhc3NlcnRUeXBlKHRoaW5nLCB0eXBlLCBlcnJvck1zZyl7XG5cdFx0Ly9BIGZ1bmN0aW9uIHRvIGNoZWNrIGlmIHNvbWV0aGluZyBpcyB0cnVlIGFuZCBoYWx0IG90aGVyd2lzZSBpbiBhIGNhbGxiYWNrYWJsZSB3YXkuXG5cdFx0aWYoISh0aGluZy5jb25zdHJ1Y3RvciA9PT0gdHlwZSkpe1xuXHRcdFx0aWYoZXJyb3JNc2cpe1xuXHRcdFx0XHRjb25zb2xlLmVycm9yKFwiRVJST1IhIFNvbWV0aGluZyBub3Qgb2YgcmVxdWlyZWQgdHlwZSBcIit0eXBlLm5hbWUrXCIhIFxcblwiK2Vycm9yTXNnK1wiXFxuIFNlZSB0cmFjZWJhY2sgZm9yIG1vcmUuXCIpO1xuXHRcdFx0fWVsc2V7XG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IoXCJFUlJPUiEgU29tZXRoaW5nIG5vdCBvZiByZXF1aXJlZCB0eXBlIFwiK3R5cGUubmFtZStcIiEgU2VlIHRyYWNlYmFjayBmb3IgbW9yZS5cIik7XG5cdFx0XHR9XG4gICAgICAgICAgICBjb25zb2xlLnRyYWNlKCk7XG5cdFx0fVxuXHR9XG5cblxuXHRzdGF0aWMgYXNzZXJ0UHJvcEV4aXN0cyh0aGluZywgbmFtZSl7XG5cdFx0aWYoIXRoaW5nIHx8ICEobmFtZSBpbiB0aGluZykpe1xuXHRcdFx0Y29uc29sZS5lcnJvcihcIkVSUk9SISBcIituYW1lK1wiIG5vdCBwcmVzZW50IGluIHJlcXVpcmVkIHByb3BlcnR5XCIpO1xuICAgICAgICAgICAgY29uc29sZS50cmFjZSgpO1xuXHRcdH1cblx0fVxuXHRcblx0c3RhdGljIGNsb25lKHZlYyl7XG5cdFx0cmV0dXJuIGNsb25lKHZlYyk7XG5cdH1cbn1cblxuZXhwb3J0IHtVdGlsc307XG4iLCJcInVzZSBzdHJpY3RcIjtcblxuaW1wb3J0IHsgVXRpbHMgfSBmcm9tICcuL3V0aWxzLmpzJztcbmltcG9ydCB7IERvbWFpbk5vZGUgfSBmcm9tICcuL05vZGUuanMnO1xuXG5jbGFzcyBBcmVhIGV4dGVuZHMgRG9tYWluTm9kZXtcblx0Y29uc3RydWN0b3Iob3B0aW9ucyl7XG5cdFx0c3VwZXIoKTtcblxuXHRcdC8qdmFyIGF4ZXMgPSBuZXcgRVhQLkFyZWEoe1xuXHRcdGJvdW5kczogW1stMTAsMTBdLFxuXHRcdFx0WzEwLDEwXV1cblx0XHRudW1JdGVtczogMTA7IC8vb3B0aW9uYWwuIEFsdGVybmF0ZWx5IG51bUl0ZW1zIGNhbiB2YXJ5IGZvciBlYWNoIGF4aXM6IG51bUl0ZW1zOiBbMTAsMl1cblx0XHR9KSovXG5cblxuXHRcblx0XHRVdGlscy5hc3NlcnRQcm9wRXhpc3RzKG9wdGlvbnMsIFwiYm91bmRzXCIpOyAvLyBhIG11bHRpZGltZW5zaW9uYWwgYXJyYXlcblx0XHRVdGlscy5hc3NlcnRUeXBlKG9wdGlvbnMuYm91bmRzLCBBcnJheSk7XG5cdFx0VXRpbHMuYXNzZXJ0VHlwZShvcHRpb25zLmJvdW5kc1swXSwgQXJyYXksIFwiRm9yIGFuIEFyZWEsIG9wdGlvbnMuYm91bmRzIG11c3QgYmUgYSBtdWx0aWRpbWVuc2lvbmFsIGFycmF5LCBldmVuIGZvciBvbmUgZGltZW5zaW9uIVwiKTsgLy8gaXQgTVVTVCBiZSBtdWx0aWRpbWVuc2lvbmFsXG5cdFx0dGhpcy5udW1EaW1lbnNpb25zID0gb3B0aW9ucy5ib3VuZHMubGVuZ3RoO1xuXG5cdFx0VXRpbHMuYXNzZXJ0KG9wdGlvbnMuYm91bmRzWzBdLmxlbmd0aCAhPSAwKTsgLy9kb24ndCBhY2NlcHQgW1tdXSwgaXQgbmVlZHMgdG8gYmUgW1sxLDJdXS5cblxuXHRcdHRoaXMuYm91bmRzID0gb3B0aW9ucy5ib3VuZHM7XG5cdFx0dGhpcy5udW1JdGVtcyA9IG9wdGlvbnMubnVtSXRlbXMgfHwgMTY7XG5cblx0XHR0aGlzLml0ZW1EaW1lbnNpb25zID0gW107IC8vIGFycmF5IHRvIHN0b3JlIHRoZSBudW1iZXIgb2YgdGltZXMgdGhpcyBpcyBjYWxsZWQgcGVyIGRpbWVuc2lvbi5cblxuXHRcdGlmKHRoaXMubnVtSXRlbXMuY29uc3RydWN0b3IgPT09IE51bWJlcil7XG5cdFx0XHRmb3IodmFyIGk9MDtpPHRoaXMubnVtRGltZW5zaW9ucztpKyspe1xuXHRcdFx0XHR0aGlzLml0ZW1EaW1lbnNpb25zLnB1c2godGhpcy5udW1JdGVtcyk7XG5cdFx0XHR9XG5cdFx0fWVsc2UgaWYodGhpcy5udW1JdGVtcy5jb25zdHJ1Y3RvciA9PT0gQXJyYXkpe1xuXHRcdFx0VXRpbHMuYXNzZXJ0KG9wdGlvbnMubnVtSXRlbXMubGVuZ3RoID09IG9wdGlvbnMuYm91bmRzLmxlbmd0aCk7XG5cdFx0XHRmb3IodmFyIGk9MDtpPHRoaXMubnVtRGltZW5zaW9ucztpKyspe1xuXHRcdFx0XHR0aGlzLml0ZW1EaW1lbnNpb25zLnB1c2godGhpcy5udW1JdGVtc1tpXSk7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0Ly90aGUgbnVtYmVyIG9mIHRpbWVzIGV2ZXJ5IGNoaWxkJ3MgZXhwciBpcyBjYWxsZWRcblx0XHR0aGlzLm51bUNhbGxzUGVyQWN0aXZhdGlvbiA9IHRoaXMuaXRlbURpbWVuc2lvbnMucmVkdWNlKChzdW0seSk9PnN1bSp5KTtcblx0fVxuXHRhY3RpdmF0ZSh0KXtcblx0XHQvL1VzZSB0aGlzIHRvIGV2YWx1YXRlIGV4cHIoKSBhbmQgdXBkYXRlIHRoZSByZXN1bHQsIGNhc2NhZGUtc3R5bGUuXG5cdFx0Ly90aGUgbnVtYmVyIG9mIGJvdW5kcyB0aGlzIG9iamVjdCBoYXMgd2lsbCBiZSB0aGUgbnVtYmVyIG9mIGRpbWVuc2lvbnMuXG5cdFx0Ly90aGUgZXhwcigpcyBhcmUgY2FsbGVkIHdpdGggZXhwcihpLCAuLi5bY29vcmRpbmF0ZXNdLCB0KSwgXG5cdFx0Ly9cdCh3aGVyZSBpIGlzIHRoZSBpbmRleCBvZiB0aGUgY3VycmVudCBldmFsdWF0aW9uID0gdGltZXMgZXhwcigpIGhhcyBiZWVuIGNhbGxlZCB0aGlzIGZyYW1lLCB0ID0gYWJzb2x1dGUgdGltZXN0ZXAgKHMpKS5cblx0XHQvL3BsZWFzZSBjYWxsIHdpdGggYSB0IHZhbHVlIG9idGFpbmVkIGZyb20gcGVyZm9ybWFuY2Uubm93KCkvMTAwMCBvciBzb21ldGhpbmcgbGlrZSB0aGF0XG5cblx0XHQvL25vdGUgdGhlIGxlc3MtdGhhbi1vci1lcXVhbC10byBpbiB0aGVzZSBsb29wc1xuXHRcdGlmKHRoaXMubnVtRGltZW5zaW9ucyA9PSAxKXtcblx0XHRcdGZvcih2YXIgaT0wO2k8dGhpcy5pdGVtRGltZW5zaW9uc1swXTtpKyspe1xuXHRcdFx0XHRsZXQgYzEgPSB0aGlzLmJvdW5kc1swXVswXSArICh0aGlzLmJvdW5kc1swXVsxXS10aGlzLmJvdW5kc1swXVswXSkqKGkvKHRoaXMuaXRlbURpbWVuc2lvbnNbMF0tMSkpO1xuXHRcdFx0XHRsZXQgaW5kZXggPSBpO1xuXHRcdFx0XHR0aGlzLl9jYWxsQWxsQ2hpbGRyZW4oaW5kZXgsdCxjMSwwLDAsMCk7XG5cdFx0XHR9XG5cdFx0fWVsc2UgaWYodGhpcy5udW1EaW1lbnNpb25zID09IDIpe1xuXHRcdFx0Ly90aGlzIGNhbiBiZSByZWR1Y2VkIGludG8gYSBmYW5jeSByZWN1cnNpb24gdGVjaG5pcXVlIG92ZXIgdGhlIGZpcnN0IGluZGV4IG9mIHRoaXMuYm91bmRzLCBJIGtub3cgaXRcblx0XHRcdGZvcih2YXIgaT0wO2k8dGhpcy5pdGVtRGltZW5zaW9uc1swXTtpKyspe1xuXHRcdFx0XHRsZXQgYzEgPSB0aGlzLmJvdW5kc1swXVswXSArICh0aGlzLmJvdW5kc1swXVsxXS10aGlzLmJvdW5kc1swXVswXSkqKGkvKHRoaXMuaXRlbURpbWVuc2lvbnNbMF0tMSkpO1xuXHRcdFx0XHRmb3IodmFyIGo9MDtqPHRoaXMuaXRlbURpbWVuc2lvbnNbMV07aisrKXtcblx0XHRcdFx0XHRsZXQgYzIgPSB0aGlzLmJvdW5kc1sxXVswXSArICh0aGlzLmJvdW5kc1sxXVsxXS10aGlzLmJvdW5kc1sxXVswXSkqKGovKHRoaXMuaXRlbURpbWVuc2lvbnNbMV0tMSkpO1xuXHRcdFx0XHRcdGxldCBpbmRleCA9IGkqdGhpcy5pdGVtRGltZW5zaW9uc1sxXSArIGo7XG5cdFx0XHRcdFx0dGhpcy5fY2FsbEFsbENoaWxkcmVuKGluZGV4LHQsYzEsYzIsMCwwKTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1lbHNlIGlmKHRoaXMubnVtRGltZW5zaW9ucyA9PSAzKXtcblx0XHRcdC8vdGhpcyBjYW4gYmUgcmVkdWNlZCBpbnRvIGEgZmFuY3kgcmVjdXJzaW9uIHRlY2huaXF1ZSBvdmVyIHRoZSBmaXJzdCBpbmRleCBvZiB0aGlzLmJvdW5kcywgSSBrbm93IGl0XG5cdFx0XHRmb3IodmFyIGk9MDtpPHRoaXMuaXRlbURpbWVuc2lvbnNbMF07aSsrKXtcblx0XHRcdFx0bGV0IGMxID0gdGhpcy5ib3VuZHNbMF1bMF0gKyAodGhpcy5ib3VuZHNbMF1bMV0tdGhpcy5ib3VuZHNbMF1bMF0pKihpLyh0aGlzLml0ZW1EaW1lbnNpb25zWzBdLTEpKTtcblx0XHRcdFx0Zm9yKHZhciBqPTA7ajx0aGlzLml0ZW1EaW1lbnNpb25zWzFdO2orKyl7XG5cdFx0XHRcdFx0bGV0IGMyID0gdGhpcy5ib3VuZHNbMV1bMF0gKyAodGhpcy5ib3VuZHNbMV1bMV0tdGhpcy5ib3VuZHNbMV1bMF0pKihqLyh0aGlzLml0ZW1EaW1lbnNpb25zWzFdLTEpKTtcblx0XHRcdFx0XHRmb3IodmFyIGs9MDtrPHRoaXMuaXRlbURpbWVuc2lvbnNbMl07aysrKXtcblx0XHRcdFx0XHRcdGxldCBjMyA9IHRoaXMuYm91bmRzWzJdWzBdICsgKHRoaXMuYm91bmRzWzJdWzFdLXRoaXMuYm91bmRzWzJdWzBdKSooay8odGhpcy5pdGVtRGltZW5zaW9uc1syXS0xKSk7XG5cdFx0XHRcdFx0XHRsZXQgaW5kZXggPSAoaSp0aGlzLml0ZW1EaW1lbnNpb25zWzFdICsgaikqdGhpcy5pdGVtRGltZW5zaW9uc1syXSArIGs7XG5cdFx0XHRcdFx0XHR0aGlzLl9jYWxsQWxsQ2hpbGRyZW4oaW5kZXgsdCxjMSxjMixjMywwKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9ZWxzZXtcblx0XHRcdGFzc2VydChcIlRPRE86IFVzZSBhIGZhbmN5IHJlY3Vyc2lvbiB0ZWNobmlxdWUgdG8gbG9vcCBvdmVyIGFsbCBpbmRpY2VzIVwiKTtcblx0XHR9XG5cblx0XHR0aGlzLm9uQWZ0ZXJBY3RpdmF0aW9uKCk7IC8vIGNhbGwgY2hpbGRyZW4gaWYgbmVjZXNzYXJ5XG5cdH1cblx0X2NhbGxBbGxDaGlsZHJlbiguLi5jb29yZGluYXRlcyl7XG5cdFx0Zm9yKHZhciBpPTA7aTx0aGlzLmNoaWxkcmVuLmxlbmd0aDtpKyspe1xuXHRcdFx0dGhpcy5jaGlsZHJlbltpXS5ldmFsdWF0ZVNlbGYoLi4uY29vcmRpbmF0ZXMpXG5cdFx0fVxuXHR9XG5cdGNsb25lKCl7XG5cdFx0bGV0IGNsb25lID0gbmV3IEFyZWEoe2JvdW5kczogVXRpbHMuYXJyYXlDb3B5KHRoaXMuYm91bmRzKSwgbnVtSXRlbXM6IHRoaXMubnVtSXRlbXN9KTtcblx0XHRmb3IodmFyIGk9MDtpPHRoaXMuY2hpbGRyZW4ubGVuZ3RoO2krKyl7XG5cdFx0XHRjbG9uZS5hZGQodGhpcy5jaGlsZHJlbltpXS5jbG9uZSgpKTtcblx0XHRcdGlmKGNsb25lLmNoaWxkcmVuW2ldLl9vbkFkZCljbG9uZS5jaGlsZHJlbltpXS5fb25BZGQoKTsgLy8gbmVjZXNzYXJ5IG5vdyB0aGF0IHRoZSBjaGFpbiBvZiBhZGRpbmcgaGFzIGJlZW4gZXN0YWJsaXNoZWRcblx0XHR9XG5cdFx0cmV0dXJuIGNsb25lO1xuXHR9XG59XG5cblxuLy90ZXN0aW5nIGNvZGVcbmZ1bmN0aW9uIHRlc3RBcmVhKCl7XG5cdHZhciB4ID0gbmV3IEFyZWEoe2JvdW5kczogW1swLDFdLFswLDFdXX0pO1xuXHR2YXIgeSA9IG5ldyBUcmFuc2Zvcm1hdGlvbih7ZXhwcjogZnVuY3Rpb24oLi4uYSl7Y29uc29sZS5sb2coLi4uYSl9fSk7XG5cdHguYWRkKHkpO1xuXHR4LmFjdGl2YXRlKCk7XG59XG5cbmV4cG9ydCB7IEFyZWEgfVxuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbmltcG9ydCBOb2RlIGZyb20gJy4vTm9kZS5qcyc7XG5cbi8vVXNhZ2U6IHZhciB5ID0gbmV3IFRyYW5zZm9ybWF0aW9uKHtleHByOiBmdW5jdGlvbiguLi5hKXtjb25zb2xlLmxvZyguLi5hKX19KTtcbmNsYXNzIFRyYW5zZm9ybWF0aW9uIGV4dGVuZHMgTm9kZXtcblx0Y29uc3RydWN0b3Iob3B0aW9ucyl7XG5cdFx0c3VwZXIoKTtcblx0XG5cdFx0RVhQLlV0aWxzLmFzc2VydFByb3BFeGlzdHMob3B0aW9ucywgXCJleHByXCIpOyAvLyBhIGZ1bmN0aW9uIHRoYXQgcmV0dXJucyBhIG11bHRpZGltZW5zaW9uYWwgYXJyYXlcblx0XHRFWFAuVXRpbHMuYXNzZXJ0VHlwZShvcHRpb25zLmV4cHIsIEZ1bmN0aW9uKTtcblxuXHRcdHRoaXMuZXhwciA9IG9wdGlvbnMuZXhwcjtcblx0fVxuXHRldmFsdWF0ZVNlbGYoLi4uY29vcmRpbmF0ZXMpe1xuXHRcdC8vZXZhbHVhdGUgdGhpcyBUcmFuc2Zvcm1hdGlvbidzIF9leHByLCBhbmQgYnJvYWRjYXN0IHRoZSByZXN1bHQgdG8gYWxsIGNoaWxkcmVuLlxuXHRcdGxldCByZXN1bHQgPSB0aGlzLmV4cHIoLi4uY29vcmRpbmF0ZXMpO1xuXHRcdGlmKHJlc3VsdC5jb25zdHJ1Y3RvciAhPT0gQXJyYXkpcmVzdWx0ID0gW3Jlc3VsdF07XG5cblx0XHRmb3IodmFyIGk9MDtpPHRoaXMuY2hpbGRyZW4ubGVuZ3RoO2krKyl7XG5cdFx0XHR0aGlzLmNoaWxkcmVuW2ldLmV2YWx1YXRlU2VsZihjb29yZGluYXRlc1swXSxjb29yZGluYXRlc1sxXSwgLi4ucmVzdWx0KVxuXHRcdH1cblx0fVxuXHRjbG9uZSgpe1xuXHRcdGxldCB0aGlzRXhwciA9IHRoaXMuZXhwcjtcblx0XHRsZXQgY2xvbmUgPSBuZXcgVHJhbnNmb3JtYXRpb24oe2V4cHI6IHRoaXNFeHByLmJpbmQoKX0pO1xuXHRcdGZvcih2YXIgaT0wO2k8dGhpcy5jaGlsZHJlbi5sZW5ndGg7aSsrKXtcblx0XHRcdGNsb25lLmFkZCh0aGlzLmNoaWxkcmVuW2ldLmNsb25lKCkpO1xuXHRcdH1cblx0XHRyZXR1cm4gY2xvbmU7XG5cdH1cblx0bWFrZUxpbmsoKXtcbiAgICAgICAgLy9saWtlIGEgY2xvbmUsIGJ1dCB3aWxsIHVzZSB0aGUgc2FtZSBleHByIGFzIHRoaXMgVHJhbnNmb3JtYXRpb24uXG4gICAgICAgIC8vdXNlZnVsIGlmIHRoZXJlJ3MgYSBzcGVjaWZpYyBmdW5jdGlvbiB0aGF0IG5lZWRzIHRvIGJlIHVzZWQgYnkgYSBidW5jaCBvZiBvYmplY3RzXG5cdFx0cmV0dXJuIG5ldyBMaW5rZWRUcmFuc2Zvcm1hdGlvbih0aGlzKTtcblx0fVxufVxuXG5jbGFzcyBMaW5rZWRUcmFuc2Zvcm1hdGlvbiBleHRlbmRzIE5vZGV7XG4gICAgLypcbiAgICAgICAgTGlrZSBhbiBFWFAuVHJhbnNmb3JtYXRpb24sIGJ1dCBpdCB1c2VzIGFuIGV4aXN0aW5nIEVYUC5UcmFuc2Zvcm1hdGlvbidzIGV4cHIoKSwgc28gaWYgdGhlIGxpbmtlZCB0cmFuc2Zvcm1hdGlvbiB1cGRhdGVzLCBzbyBkb2VzIHRoaXMgb25lLiBJdCdzIGxpa2UgYSBwb2ludGVyIHRvIGEgVHJhbnNmb3JtYXRpb24sIGJ1dCBpbiBvYmplY3QgZm9ybS4gXG4gICAgKi9cblx0Y29uc3RydWN0b3IodHJhbnNmb3JtYXRpb25Ub0xpbmtUbyl7XG5cdFx0c3VwZXIoe30pO1xuXHRcdEVYUC5VdGlscy5hc3NlcnRUeXBlKHRyYW5zZm9ybWF0aW9uVG9MaW5rVG8sIFRyYW5zZm9ybWF0aW9uKTtcbiAgICAgICAgdGhpcy5saW5rZWRUcmFuc2Zvcm1hdGlvbk5vZGUgPSB0cmFuc2Zvcm1hdGlvblRvTGlua1RvO1xuXHR9XG5cdGV2YWx1YXRlU2VsZiguLi5jb29yZGluYXRlcyl7XG5cdFx0bGV0IHJlc3VsdCA9IHRoaXMubGlua2VkVHJhbnNmb3JtYXRpb25Ob2RlLmV4cHIoLi4uY29vcmRpbmF0ZXMpO1xuXHRcdGlmKHJlc3VsdC5jb25zdHJ1Y3RvciAhPT0gQXJyYXkpcmVzdWx0ID0gW3Jlc3VsdF07XG5cblx0XHRmb3IodmFyIGk9MDtpPHRoaXMuY2hpbGRyZW4ubGVuZ3RoO2krKyl7XG5cdFx0XHR0aGlzLmNoaWxkcmVuW2ldLmV2YWx1YXRlU2VsZihjb29yZGluYXRlc1swXSxjb29yZGluYXRlc1sxXSwgLi4ucmVzdWx0KVxuXHRcdH1cblx0fVxuXHRjbG9uZSgpe1xuXHRcdGxldCBjbG9uZSA9IG5ldyBMaW5rZWRUcmFuc2Zvcm1hdGlvbih0aGlzLmxpbmtlZFRyYW5zZm9ybWF0aW9uTm9kZSk7XG5cdFx0Zm9yKHZhciBpPTA7aTx0aGlzLmNoaWxkcmVuLmxlbmd0aDtpKyspe1xuXHRcdFx0Y2xvbmUuYWRkKHRoaXMuY2hpbGRyZW5baV0uY2xvbmUoKSk7XG5cdFx0fVxuXHRcdHJldHVybiBjbG9uZTtcblx0fVxuXHRtYWtlTGluaygpe1xuXHRcdHJldHVybiBuZXcgTGlua2VkVHJhbnNmb3JtYXRpb24odGhpcy5saW5rZWRUcmFuc2Zvcm1hdGlvbk5vZGUpO1xuXHR9XG59XG5cblxuXG5cblxuLy90ZXN0aW5nIGNvZGVcbmZ1bmN0aW9uIHRlc3RUcmFuc2Zvcm1hdGlvbigpe1xuXHR2YXIgeCA9IG5ldyBBcmVhKHtib3VuZHM6IFtbLTEwLDEwXV19KTtcblx0dmFyIHkgPSBuZXcgVHJhbnNmb3JtYXRpb24oeydleHByJzogKHgpID0+IGNvbnNvbGUubG9nKHgqeCl9KTtcblx0eC5hZGQoeSk7XG5cdHguYWN0aXZhdGUoKTsgLy8gc2hvdWxkIHJldHVybiAxMDAsIDgxLCA2NC4uLiAwLCAxLCA0Li4uIDEwMFxufVxuXG5leHBvcnQgeyBUcmFuc2Zvcm1hdGlvbiwgTGlua2VkVHJhbnNmb3JtYXRpb259XG4iLCJcInVzZSBzdHJpY3RcIjtcblxuaW1wb3J0IHsgRG9tYWluTm9kZSB9IGZyb20gJy4vTm9kZS5qcyc7XG5cbmNsYXNzIEhpc3RvcnlSZWNvcmRlciBleHRlbmRzIERvbWFpbk5vZGV7XG5cdGNvbnN0cnVjdG9yKG9wdGlvbnMpe1xuXHRcdHN1cGVyKCk7XG5cbiAgICAgICAgLypcbiAgICAgICAgICAgIENsYXNzIHRoYXQgcmVjb3JkcyB0aGUgbGFzdCBmZXcgdmFsdWVzIG9mIHRoZSBwYXJlbnQgVHJhbnNmb3JtYXRpb24gYW5kIG1ha2VzIHRoZW0gYXZhaWxhYmxlIGZvciB1c2UgYXMgYW4gZXh0cmEgZGltZW5zaW9uLlxuICAgICAgICAgICAgVXNhZ2U6XG4gICAgICAgICAgICB2YXIgcmVjb3JkZXIgPSBuZXcgSGlzdG9yeVJlY29yZGVyKHtcbiAgICAgICAgICAgICAgICBtZW1vcnlMZW5ndGg6IDEwIC8vIGhvdyBtYW55IHBhc3QgdmFsdWVzIHRvIHN0b3JlP1xuICAgICAgICAgICAgICAgIHJlY29yZEZyYW1lSW50ZXJ2YWw6IDE1Ly9Ib3cgbG9uZyB0byB3YWl0IGJldHdlZW4gZWFjaCBjYXB0dXJlPyBNZWFzdXJlZCBpbiBmcmFtZXMsIHNvIDYwID0gMSBjYXB0dXJlIHBlciBzZWNvbmQsIDMwID0gMiBjYXB0dXJlcy9zZWNvbmQsIGV0Yy5cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBleGFtcGxlIHVzYWdlOlxuICAgICAgICAgICAgbmV3IEFyZWEoe2JvdW5kczogW1stNSw1XV19KS5hZGQobmV3IFRyYW5zZm9ybWF0aW9uKHtleHByOiAoaSx0LHgpID0+IFtNYXRoLnNpbih4KSxNYXRoLmNvcyh4KV19KSkuYWRkKG5ldyBFWFAuSGlzdG9yeVJlY29yZGVyKHttZW1vcnlMZW5ndGg6IDV9KS5hZGQobmV3IExpbmVPdXRwdXQoe3dpZHRoOiA1LCBjb2xvcjogMHhmZjAwMDB9KSk7XG5cbiAgICAgICAgICAgIE5PVEU6IEl0IGlzIGFzc3VtZWQgdGhhdCBhbnkgcGFyZW50IHRyYW5zZm9ybWF0aW9uIG91dHB1dHMgYW4gYXJyYXkgb2YgbnVtYmVycyB0aGF0IGlzIDQgb3IgbGVzcyBpbiBsZW5ndGguXG4gICAgICAgICovXG5cblx0XHR0aGlzLm1lbW9yeUxlbmd0aCA9IG9wdGlvbnMubWVtb3J5TGVuZ3RoID09PSB1bmRlZmluZWQgPyAxMCA6IG9wdGlvbnMubWVtb3J5TGVuZ3RoO1xuICAgICAgICB0aGlzLnJlY29yZEZyYW1lSW50ZXJ2YWwgPSBvcHRpb25zLnJlY29yZEZyYW1lSW50ZXJ2YWwgPT09IHVuZGVmaW5lZCA/IDE1IDogb3B0aW9ucy5yZWNvcmRGcmFtZUludGVydmFsOyAvL3NldCB0byAxIHRvIHJlY29yZCBldmVyeSBmcmFtZS5cbiAgICAgICAgdGhpcy5fb3V0cHV0RGltZW5zaW9ucyA9IDQ7IC8vaG93IG1hbnkgZGltZW5zaW9ucyBwZXIgcG9pbnQgdG8gc3RvcmU/ICh0b2RvOiBhdXRvZGV0ZWN0IHRoaXMgZnJvbSBwYXJlbnQncyBvdXRwdXQpXG5cdFx0dGhpcy5jdXJyZW50SGlzdG9yeUluZGV4PTA7XG4gICAgICAgIHRoaXMuZnJhbWVSZWNvcmRUaW1lciA9IDA7XG5cdH1cblx0X29uQWRkKCl7XG5cdFx0Ly9jbGltYiB1cCBwYXJlbnQgaGllcmFyY2h5IHRvIGZpbmQgdGhlIEFyZWFcblx0XHRsZXQgcm9vdCA9IHRoaXMuZ2V0Q2xvc2VzdERvbWFpbigpO1xuXG5cdFx0dGhpcy5udW1DYWxsc1BlckFjdGl2YXRpb24gPSByb290Lm51bUNhbGxzUGVyQWN0aXZhdGlvbiAqIHRoaXMubWVtb3J5TGVuZ3RoO1xuXHRcdHRoaXMuaXRlbURpbWVuc2lvbnMgPSByb290Lml0ZW1EaW1lbnNpb25zLmNvbmNhdChbdGhpcy5tZW1vcnlMZW5ndGhdKTtcblxuICAgICAgICB0aGlzLmJ1ZmZlciA9IG5ldyBGbG9hdDMyQXJyYXkodGhpcy5udW1DYWxsc1BlckFjdGl2YXRpb24gKiB0aGlzLl9vdXRwdXREaW1lbnNpb25zKTtcbiAgICBcbiAgICAgICAgLy9UaGlzIGlzIHNvIHRoYXQgbm8gc3VyZmFjZS9ib3VuZGFyeSB3aWxsIGFwcGVhciB1bnRpbCBoaXN0b3J5IGJlZ2lucyB0byBiZSByZWNvcmRlZC4gSSdtIHNvIHNvcnJ5LlxuICAgICAgICAvL1RvZG86IHByb3BlciBjbGlwIHNoYWRlciBsaWtlIG1hdGhib3ggZG9lcyBvciBzb21ldGhpbmcuXG4gICAgICAgIHRoaXMuYnVmZmVyLmZpbGwoTmFOKTsgXG5cdH1cbiAgICBvbkFmdGVyQWN0aXZhdGlvbigpe1xuICAgICAgICBzdXBlci5vbkFmdGVyQWN0aXZhdGlvbigpO1xuXG4gICAgICAgIC8vZXZlcnkgc28gb2Z0ZW4sIHNoaWZ0IHRvIHRoZSBuZXh0IGJ1ZmZlciBzbG90XG4gICAgICAgIHRoaXMuZnJhbWVSZWNvcmRUaW1lciArPSAxO1xuICAgICAgICBpZih0aGlzLmZyYW1lUmVjb3JkVGltZXIgPj0gdGhpcy5yZWNvcmRGcmFtZUludGVydmFsKXtcbiAgICAgICAgICAgIC8vcmVzZXQgZnJhbWUgcmVjb3JkIHRpbWVyXG4gICAgICAgICAgICB0aGlzLmZyYW1lUmVjb3JkVGltZXIgPSAwO1xuICAgICAgICAgICAgdGhpcy5jdXJyZW50SGlzdG9yeUluZGV4ID0gKHRoaXMuY3VycmVudEhpc3RvcnlJbmRleCsxKSV0aGlzLm1lbW9yeUxlbmd0aDtcbiAgICAgICAgfVxuICAgIH1cblx0ZXZhbHVhdGVTZWxmKC4uLmNvb3JkaW5hdGVzKXtcblx0XHQvL2V2YWx1YXRlIHRoaXMgVHJhbnNmb3JtYXRpb24ncyBfZXhwciwgYW5kIGJyb2FkY2FzdCB0aGUgcmVzdWx0IHRvIGFsbCBjaGlsZHJlbi5cblx0XHRsZXQgaSA9IGNvb3JkaW5hdGVzWzBdO1xuXHRcdGxldCB0ID0gY29vcmRpbmF0ZXNbMV07XG4gICAgXG4gICAgICAgIC8vc3RlcCAxOiBzYXZlIGNvb3JkaW5hdGVzIGZvciB0aGlzIGZyYW1lIGluIGJ1ZmZlclxuICAgICAgICBpZihjb29yZGluYXRlcy5sZW5ndGggPiAyK3RoaXMuX291dHB1dERpbWVuc2lvbnMpe1xuICAgICAgICAgICAgLy90b2RvOiBtYWtlIHRoaXMgdXBkYXRlIHRoaXMuX291dHB1dERpbWVuc2lvbnMgYW5kIHJlYWxsb2NhdGUgbW9yZSBidWZmZXIgc3BhY2VcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkVYUC5IaXN0b3J5UmVjb3JkZXIgaXMgdW5hYmxlIHRvIHJlY29yZCBoaXN0b3J5IG9mIHNvbWV0aGluZyB0aGF0IG91dHB1dHMgaW4gXCIrdGhpcy5fb3V0cHV0RGltZW5zaW9ucytcIiBkaW1lbnNpb25zISBZZXQuXCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IGN5Y2xpY0J1ZmZlckluZGV4ID0gKGkqdGhpcy5tZW1vcnlMZW5ndGgrdGhpcy5jdXJyZW50SGlzdG9yeUluZGV4KSp0aGlzLl9vdXRwdXREaW1lbnNpb25zO1xuICAgICAgICBmb3IodmFyIGo9MDtqPGNvb3JkaW5hdGVzLmxlbmd0aC0yO2orKyl7IFxuICAgICAgICAgICAgdGhpcy5idWZmZXJbY3ljbGljQnVmZmVySW5kZXgral0gPSBjb29yZGluYXRlc1syK2pdO1xuICAgICAgICB9XG5cbiAgICAgICAgLy9zdGVwIDI6LCBjYWxsIGFueSBjaGlsZHJlbiBvbmNlIHBlciBoaXN0b3J5IGl0ZW1cbiAgICAgICAgZm9yKHZhciBjaGlsZE5vPTA7Y2hpbGRObzx0aGlzLmNoaWxkcmVuLmxlbmd0aDtjaGlsZE5vKyspe1xuXHRcdCAgICBmb3IodmFyIGo9MDtqPHRoaXMubWVtb3J5TGVuZ3RoO2orKyl7XG5cbiAgICAgICAgICAgICAgICAvL3RoZSArMSBpbiAoaiArIHRoaXMuY3VycmVudEhpc3RvcnlJbmRleCArIDEpIGlzIGltcG9ydGFudDsgd2l0aG91dCBpdCwgYSBMaW5lT3V0cHV0IHdpbGwgZHJhdyBhIGxpbmUgZnJvbSB0aGUgbW9zdCByZWNlbnQgdmFsdWUgdG8gdGhlIGVuZCBvZiBoaXN0b3J5XG4gICAgICAgICAgICAgICAgbGV0IGN5Y2xpY0hpc3RvcnlWYWx1ZSA9IChqICsgdGhpcy5jdXJyZW50SGlzdG9yeUluZGV4ICsgMSkgJSB0aGlzLm1lbW9yeUxlbmd0aDtcbiAgICAgICAgICAgICAgICBsZXQgY3ljbGljQnVmZmVySW5kZXggPSAoaSAqIHRoaXMubWVtb3J5TGVuZ3RoICsgY3ljbGljSGlzdG9yeVZhbHVlKSp0aGlzLl9vdXRwdXREaW1lbnNpb25zO1xuICAgICAgICAgICAgICAgIGxldCBub25DeWNsaWNJbmRleCA9IGkgKiB0aGlzLm1lbW9yeUxlbmd0aCArIGo7XG5cblx0XHQgICAgICAgIC8vSSdtIHRvcm4gb24gd2hldGhlciB0byBhZGQgYSBmaW5hbCBjb29yZGluYXRlIGF0IHRoZSBlbmQgc28gaGlzdG9yeSBjYW4gZ28gb2ZmIGluIGEgbmV3IGRpcmVjdGlvbi5cbiAgICAgICAgICAgICAgICAvL3RoaXMuY2hpbGRyZW5bY2hpbGROb10uZXZhbHVhdGVTZWxmKG5vbkN5Y2xpY0luZGV4LHQsdGhpcy5idWZmZXJbY3ljbGljQnVmZmVySW5kZXhdLCBjeWNsaWNIaXN0b3J5VmFsdWUpO1xuICAgICAgICAgICAgICAgIHRoaXMuY2hpbGRyZW5bY2hpbGROb10uZXZhbHVhdGVTZWxmKFxuICAgICAgICAgICAgICAgICAgICAgICAgbm9uQ3ljbGljSW5kZXgsdCwgLy9pLHRcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLnRoaXMuYnVmZmVyLnNsaWNlKGN5Y2xpY0J1ZmZlckluZGV4LGN5Y2xpY0J1ZmZlckluZGV4K3RoaXMuX291dHB1dERpbWVuc2lvbnMpIC8vZXh0cmFjdCBjb29yZGluYXRlcyBmb3IgdGhpcyBoaXN0b3J5IHZhbHVlIGZyb20gYnVmZmVyXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXHR9XG5cdGNsb25lKCl7XG5cdFx0bGV0IGNsb25lID0gbmV3IEhpc3RvcnlSZWNvcmRlcih7bWVtb3J5TGVuZ3RoOiB0aGlzLm1lbW9yeUxlbmd0aCwgcmVjb3JkRnJhbWVJbnRlcnZhbDogdGhpcy5yZWNvcmRGcmFtZUludGVydmFsfSk7XG5cdFx0Zm9yKHZhciBpPTA7aTx0aGlzLmNoaWxkcmVuLmxlbmd0aDtpKyspe1xuXHRcdFx0Y2xvbmUuYWRkKHRoaXMuY2hpbGRyZW5baV0uY2xvbmUoKSk7XG5cdFx0fVxuXHRcdHJldHVybiBjbG9uZTtcblx0fVxufVxuXG5leHBvcnQgeyBIaXN0b3J5UmVjb3JkZXIgfVxuIiwidmFyIHRocmVlRW52aXJvbm1lbnQgPSBudWxsO1xuXG5mdW5jdGlvbiBzZXRUaHJlZUVudmlyb25tZW50KG5ld0Vudil7XG4gICAgdGhyZWVFbnZpcm9ubWVudCA9IG5ld0Vudjtcbn1cbmZ1bmN0aW9uIGdldFRocmVlRW52aXJvbm1lbnQoKXtcbiAgICByZXR1cm4gdGhyZWVFbnZpcm9ubWVudDtcbn1cbmV4cG9ydCB7c2V0VGhyZWVFbnZpcm9ubWVudCwgZ2V0VGhyZWVFbnZpcm9ubWVudCwgdGhyZWVFbnZpcm9ubWVudH07XG4iLCJpbXBvcnQgeyBVdGlscyB9IGZyb20gJy4vdXRpbHMuanMnO1xuXG5pbXBvcnQgeyBUcmFuc2Zvcm1hdGlvbiB9IGZyb20gJy4vVHJhbnNmb3JtYXRpb24uanMnO1xuXG5pbXBvcnQgKiBhcyBtYXRoIGZyb20gJy4vbWF0aC5qcyc7XG5pbXBvcnQgeyB0aHJlZUVudmlyb25tZW50IH0gZnJvbSAnLi9UaHJlZUVudmlyb25tZW50LmpzJztcblxubGV0IEVQUyA9IE51bWJlci5FUFNJTE9OO1xuXG5jbGFzcyBBbmltYXRpb257XG5cdGNvbnN0cnVjdG9yKHRhcmdldCwgdG9WYWx1ZXMsIGR1cmF0aW9uLCBzdGFnZ2VyRnJhY3Rpb24pe1xuXHRcdFV0aWxzLmFzc2VydFR5cGUodG9WYWx1ZXMsIE9iamVjdCk7XG5cblx0XHR0aGlzLnRvVmFsdWVzID0gdG9WYWx1ZXM7XG5cdFx0dGhpcy50YXJnZXQgPSB0YXJnZXQ7XHRcblx0XHR0aGlzLnN0YWdnZXJGcmFjdGlvbiA9IHN0YWdnZXJGcmFjdGlvbiA9PT0gdW5kZWZpbmVkID8gMCA6IHN0YWdnZXJGcmFjdGlvbjsgLy8gdGltZSBpbiBtcyBiZXR3ZWVuIGZpcnN0IGVsZW1lbnQgYmVnaW5uaW5nIHRoZSBhbmltYXRpb24gYW5kIGxhc3QgZWxlbWVudCBiZWdpbm5pbmcgdGhlIGFuaW1hdGlvbi4gU2hvdWxkIGJlIGxlc3MgdGhhbiBkdXJhdGlvbi5cbnJcblxuXHRcdFV0aWxzLmFzc2VydCh0aGlzLnN0YWdnZXJGcmFjdGlvbiA+PSAwICYmIHRoaXMuc3RhZ2dlckZyYWN0aW9uIDwgMSk7XG5cblx0XHR0aGlzLmZyb21WYWx1ZXMgPSB7fTtcblx0XHRmb3IodmFyIHByb3BlcnR5IGluIHRoaXMudG9WYWx1ZXMpe1xuXHRcdFx0VXRpbHMuYXNzZXJ0UHJvcEV4aXN0cyh0aGlzLnRhcmdldCwgcHJvcGVydHkpO1xuXG5cdFx0XHQvL2NvcHkgcHJvcGVydHksIG1ha2luZyBzdXJlIHRvIHN0b3JlIHRoZSBjb3JyZWN0ICd0aGlzJ1xuXHRcdFx0aWYoVXRpbHMuaXNGdW5jdGlvbih0aGlzLnRhcmdldFtwcm9wZXJ0eV0pKXtcblx0XHRcdFx0dGhpcy5mcm9tVmFsdWVzW3Byb3BlcnR5XSA9IHRoaXMudGFyZ2V0W3Byb3BlcnR5XS5iaW5kKHRoaXMudGFyZ2V0KTtcblx0XHRcdH1lbHNle1xuXHRcdFx0XHR0aGlzLmZyb21WYWx1ZXNbcHJvcGVydHldID0gdGhpcy50YXJnZXRbcHJvcGVydHldO1xuXHRcdFx0fVxuXHRcdH1cblxuXG5cdFx0dGhpcy5kdXJhdGlvbiA9IGR1cmF0aW9uID09PSB1bmRlZmluZWQgPyAxIDogZHVyYXRpb247IC8vaW4gc1xuXHRcdHRoaXMuZWxhcHNlZFRpbWUgPSAwO1xuXG4gICAgICAgIHRoaXMucHJldlRydWVUaW1lID0gMDtcblxuXG5cdFx0aWYodGFyZ2V0LmNvbnN0cnVjdG9yID09PSBUcmFuc2Zvcm1hdGlvbil7XG5cdFx0XHQvL2ZpbmQgb3V0IGhvdyBtYW55IG9iamVjdHMgYXJlIHBhc3NpbmcgdGhyb3VnaCB0aGlzIHRyYW5zZm9ybWF0aW9uXG5cdFx0XHRsZXQgcm9vdCA9IHRhcmdldDtcblx0XHRcdHdoaWxlKHJvb3QucGFyZW50ICE9PSBudWxsKXtcblx0XHRcdFx0cm9vdCA9IHJvb3QucGFyZW50O1xuXHRcdFx0fVxuXHRcdFx0dGhpcy50YXJnZXROdW1DYWxsc1BlckFjdGl2YXRpb24gPSByb290Lm51bUNhbGxzUGVyQWN0aXZhdGlvbjtcblx0XHR9ZWxzZXtcblx0XHRcdGlmKHRoaXMuc3RhZ2dlckZyYWN0aW9uICE9IDApe1xuXHRcdFx0XHRjb25zb2xlLmVycm9yKFwic3RhZ2dlckZyYWN0aW9uIGNhbiBvbmx5IGJlIHVzZWQgd2hlbiBUcmFuc2l0aW9uVG8ncyB0YXJnZXQgaXMgYW4gRVhQLlRyYW5zZm9ybWF0aW9uIVwiKTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHQvL2JlZ2luXG5cdFx0dGhpcy5fdXBkYXRlQ2FsbGJhY2sgPSB0aGlzLnVwZGF0ZS5iaW5kKHRoaXMpXG5cdFx0dGhyZWVFbnZpcm9ubWVudC5vbihcInVwZGF0ZVwiLHRoaXMuX3VwZGF0ZUNhbGxiYWNrKTtcblx0fVxuXHR1cGRhdGUodGltZSl7XG5cdFx0dGhpcy5lbGFwc2VkVGltZSArPSB0aW1lLnJlYWx0aW1lRGVsdGE7XHRcblxuXHRcdGxldCBwZXJjZW50YWdlID0gdGhpcy5lbGFwc2VkVGltZS90aGlzLmR1cmF0aW9uO1xuXG5cdFx0Ly9pbnRlcnBvbGF0ZSB2YWx1ZXNcblx0XHRmb3IobGV0IHByb3BlcnR5IGluIHRoaXMudG9WYWx1ZXMpe1xuXHRcdFx0dGhpcy5pbnRlcnBvbGF0ZShwZXJjZW50YWdlLCBwcm9wZXJ0eSwgdGhpcy5mcm9tVmFsdWVzW3Byb3BlcnR5XSx0aGlzLnRvVmFsdWVzW3Byb3BlcnR5XSk7XG5cdFx0fVxuXG5cdFx0aWYodGhpcy5lbGFwc2VkVGltZSA+PSB0aGlzLmR1cmF0aW9uKXtcblx0XHRcdHRoaXMuZW5kKCk7XG5cdFx0fVxuXHR9XG5cdGludGVycG9sYXRlKHBlcmNlbnRhZ2UsIHByb3BlcnR5TmFtZSwgZnJvbVZhbHVlLCB0b1ZhbHVlKXtcblx0XHRjb25zdCBudW1PYmplY3RzID0gdGhpcy50YXJnZXROdW1DYWxsc1BlckFjdGl2YXRpb247XG5cblx0XHR2YXIgbmV3VmFsdWUgPSBudWxsO1xuXHRcdGlmKHR5cGVvZih0b1ZhbHVlKSA9PT0gXCJudW1iZXJcIiAmJiB0eXBlb2YoZnJvbVZhbHVlKSA9PT0gXCJudW1iZXJcIil7XG5cdFx0XHRsZXQgdCA9IHRoaXMuaW50ZXJwb2xhdGlvbkZ1bmN0aW9uKHBlcmNlbnRhZ2UpO1xuXHRcdFx0dGhpcy50YXJnZXRbcHJvcGVydHlOYW1lXSA9IHQqdG9WYWx1ZSArICgxLXQpKmZyb21WYWx1ZTtcblx0XHRcdHJldHVybjtcblx0XHR9ZWxzZSBpZihVdGlscy5pc0Z1bmN0aW9uKHRvVmFsdWUpICYmIFV0aWxzLmlzRnVuY3Rpb24oZnJvbVZhbHVlKSl7XG5cdFx0XHQvL2lmIHN0YWdnZXJGcmFjdGlvbiAhPSAwLCBpdCdzIHRoZSBhbW91bnQgb2YgdGltZSBiZXR3ZWVuIHRoZSBmaXJzdCBwb2ludCdzIHN0YXJ0IHRpbWUgYW5kIHRoZSBsYXN0IHBvaW50J3Mgc3RhcnQgdGltZS5cblx0XHRcdC8vQVNTVU1QVElPTjogdGhlIGZpcnN0IHZhcmlhYmxlIG9mIHRoaXMgZnVuY3Rpb24gaXMgaSwgYW5kIGl0J3MgYXNzdW1lZCBpIGlzIHplcm8taW5kZXhlZC5cblxuXHRcdFx0Ly9lbmNhcHN1bGF0ZSBwZXJjZW50YWdlXG5cdFx0XHR0aGlzLnRhcmdldFtwcm9wZXJ0eU5hbWVdID0gKGZ1bmN0aW9uKC4uLmNvb3Jkcyl7XG4gICAgICAgICAgICAgICAgY29uc3QgaSA9IGNvb3Jkc1swXTtcblx0XHRcdFx0bGV0IGxlcnBGYWN0b3IgPSBwZXJjZW50YWdlO1xuXG4gICAgICAgICAgICAgICAgLy9mYW5jeSBzdGFnZ2VyaW5nIG1hdGgsIGlmIHdlIGtub3cgaG93IG1hbnkgb2JqZWN0cyBhcmUgZmxvd2luZyB0aHJvdWdoIHRoaXMgdHJhbnNmb3JtYXRpb24gYXQgb25jZVxuICAgICAgICAgICAgICAgIGlmKHRoaXMudGFyZ2V0TnVtQ2FsbHNQZXJBY3RpdmF0aW9uICE9PSB1bmRlZmluZWQpe1xuICAgICAgICAgICAgICAgICAgICBsZXJwRmFjdG9yID0gcGVyY2VudGFnZS8oMS10aGlzLnN0YWdnZXJGcmFjdGlvbitFUFMpIC0gaSp0aGlzLnN0YWdnZXJGcmFjdGlvbi90aGlzLnRhcmdldE51bUNhbGxzUGVyQWN0aXZhdGlvbjtcbiAgICAgICAgICAgICAgICB9XG5cdFx0XHRcdC8vbGV0IHBlcmNlbnQgPSBNYXRoLm1pbihNYXRoLm1heChwZXJjZW50YWdlIC0gaS90aGlzLnRhcmdldE51bUNhbGxzUGVyQWN0aXZhdGlvbiAgICwxKSwwKTtcblxuXHRcdFx0XHRsZXQgdCA9IHRoaXMuaW50ZXJwb2xhdGlvbkZ1bmN0aW9uKE1hdGgubWF4KE1hdGgubWluKGxlcnBGYWN0b3IsMSksMCkpO1xuXHRcdFx0XHRyZXR1cm4gbWF0aC5sZXJwVmVjdG9ycyh0LHRvVmFsdWUoLi4uY29vcmRzKSxmcm9tVmFsdWUoLi4uY29vcmRzKSlcblx0XHRcdH0pLmJpbmQodGhpcyk7XG5cdFx0XHRyZXR1cm47XG5cdFx0fWVsc2UgaWYodG9WYWx1ZS5jb25zdHJ1Y3RvciA9PT0gVEhSRUUuQ29sb3IgJiYgZnJvbVZhbHVlLmNvbnN0cnVjdG9yID09PSBUSFJFRS5Db2xvcil7XG4gICAgICAgICAgICBsZXQgdCA9IHRoaXMuaW50ZXJwb2xhdGlvbkZ1bmN0aW9uKHBlcmNlbnRhZ2UpO1xuICAgICAgICAgICAgbGV0IGNvbG9yID0gZnJvbVZhbHVlLmNsb25lKCk7XG4gICAgICAgICAgICB0aGlzLnRhcmdldFtwcm9wZXJ0eU5hbWVdID0gY29sb3IubGVycCh0b1ZhbHVlLCB0KTtcbiAgICAgICAgfWVsc2UgaWYodHlwZW9mKHRvVmFsdWUpID09PSBcImJvb2xlYW5cIiAmJiB0eXBlb2YoZnJvbVZhbHVlKSA9PT0gXCJib29sZWFuXCIpe1xuICAgICAgICAgICAgbGV0IHQgPSB0aGlzLmludGVycG9sYXRpb25GdW5jdGlvbihwZXJjZW50YWdlKTtcbiAgICAgICAgICAgIHRoaXMudGFyZ2V0W3Byb3BlcnR5TmFtZV0gPSB0ID4gMC41ID8gdG9WYWx1ZSA6IGZyb21WYWx1ZTtcbiAgICAgICAgfWVsc2V7XG5cdFx0XHRjb25zb2xlLmVycm9yKFwiQW5pbWF0aW9uIGNsYXNzIGNhbm5vdCB5ZXQgaGFuZGxlIHRyYW5zaXRpb25pbmcgYmV0d2VlbiB0aGluZ3MgdGhhdCBhcmVuJ3QgbnVtYmVycyBvciBmdW5jdGlvbnMhXCIpO1xuXHRcdH1cblxuXHR9XG5cdGludGVycG9sYXRpb25GdW5jdGlvbih4KXtcblx0XHRyZXR1cm4gdGhpcy5jb3NpbmVJbnRlcnBvbGF0aW9uKHgpO1xuXHR9XG5cdGNvc2luZUludGVycG9sYXRpb24oeCl7XG5cdFx0cmV0dXJuICgxLU1hdGguY29zKHgqTWF0aC5QSSkpLzI7XG5cdH1cblx0bGluZWFySW50ZXJwb2xhdGlvbih4KXtcblx0XHRyZXR1cm4geDtcblx0fVxuXHRlbmQoKXtcblx0XHRmb3IodmFyIHByb3AgaW4gdGhpcy50b1ZhbHVlcyl7XG5cdFx0XHR0aGlzLnRhcmdldFtwcm9wXSA9IHRoaXMudG9WYWx1ZXNbcHJvcF07XG5cdFx0fVxuXHRcdHRocmVlRW52aXJvbm1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInVwZGF0ZVwiLHRoaXMuX3VwZGF0ZUNhbGxiYWNrKTtcblx0XHQvL1RvZG86IGRlbGV0ZSB0aGlzXG5cdH1cbn1cblxuLy90b2RvOiBwdXQgdGhpcyBpbnRvIGEgRGlyZWN0b3IgY2xhc3Mgc28gdGhhdCBpdCBjYW4gaGF2ZSBhbiB1bmRvIHN0YWNrXG5mdW5jdGlvbiBUcmFuc2l0aW9uVG8odGFyZ2V0LCB0b1ZhbHVlcywgZHVyYXRpb25NUywgc3RhZ2dlckZyYWN0aW9uKXtcblx0dmFyIGFuaW1hdGlvbiA9IG5ldyBBbmltYXRpb24odGFyZ2V0LCB0b1ZhbHVlcywgZHVyYXRpb25NUyA9PT0gdW5kZWZpbmVkID8gdW5kZWZpbmVkIDogZHVyYXRpb25NUy8xMDAwLCBzdGFnZ2VyRnJhY3Rpb24pO1xufVxuXG5leHBvcnQge1RyYW5zaXRpb25UbywgQW5pbWF0aW9ufVxuIiwiKGZ1bmN0aW9uICgpIHtcblx0XCJ1c2Ugc3RyaWN0XCI7XG5cblx0dmFyIGxvb2t1cCA9IFtcblx0XHRcdCdBJywgJ0InLCAnQycsICdEJywgJ0UnLCAnRicsICdHJywgJ0gnLFxuXHRcdFx0J0knLCAnSicsICdLJywgJ0wnLCAnTScsICdOJywgJ08nLCAnUCcsXG5cdFx0XHQnUScsICdSJywgJ1MnLCAnVCcsICdVJywgJ1YnLCAnVycsICdYJyxcblx0XHRcdCdZJywgJ1onLCAnYScsICdiJywgJ2MnLCAnZCcsICdlJywgJ2YnLFxuXHRcdFx0J2cnLCAnaCcsICdpJywgJ2onLCAnaycsICdsJywgJ20nLCAnbicsXG5cdFx0XHQnbycsICdwJywgJ3EnLCAncicsICdzJywgJ3QnLCAndScsICd2Jyxcblx0XHRcdCd3JywgJ3gnLCAneScsICd6JywgJzAnLCAnMScsICcyJywgJzMnLFxuXHRcdFx0JzQnLCAnNScsICc2JywgJzcnLCAnOCcsICc5JywgJysnLCAnLydcblx0XHRdO1xuXHRmdW5jdGlvbiBjbGVhbihsZW5ndGgpIHtcblx0XHR2YXIgaSwgYnVmZmVyID0gbmV3IFVpbnQ4QXJyYXkobGVuZ3RoKTtcblx0XHRmb3IgKGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcblx0XHRcdGJ1ZmZlcltpXSA9IDA7XG5cdFx0fVxuXHRcdHJldHVybiBidWZmZXI7XG5cdH1cblxuXHRmdW5jdGlvbiBleHRlbmQob3JpZywgbGVuZ3RoLCBhZGRMZW5ndGgsIG11bHRpcGxlT2YpIHtcblx0XHR2YXIgbmV3U2l6ZSA9IGxlbmd0aCArIGFkZExlbmd0aCxcblx0XHRcdGJ1ZmZlciA9IGNsZWFuKChwYXJzZUludChuZXdTaXplIC8gbXVsdGlwbGVPZikgKyAxKSAqIG11bHRpcGxlT2YpO1xuXG5cdFx0YnVmZmVyLnNldChvcmlnKTtcblxuXHRcdHJldHVybiBidWZmZXI7XG5cdH1cblxuXHRmdW5jdGlvbiBwYWQobnVtLCBieXRlcywgYmFzZSkge1xuXHRcdG51bSA9IG51bS50b1N0cmluZyhiYXNlIHx8IDgpO1xuXHRcdHJldHVybiBcIjAwMDAwMDAwMDAwMFwiLnN1YnN0cihudW0ubGVuZ3RoICsgMTIgLSBieXRlcykgKyBudW07XG5cdH1cblxuXHRmdW5jdGlvbiBzdHJpbmdUb1VpbnQ4IChpbnB1dCwgb3V0LCBvZmZzZXQpIHtcblx0XHR2YXIgaSwgbGVuZ3RoO1xuXG5cdFx0b3V0ID0gb3V0IHx8IGNsZWFuKGlucHV0Lmxlbmd0aCk7XG5cblx0XHRvZmZzZXQgPSBvZmZzZXQgfHwgMDtcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSBpbnB1dC5sZW5ndGg7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuXHRcdFx0b3V0W29mZnNldF0gPSBpbnB1dC5jaGFyQ29kZUF0KGkpO1xuXHRcdFx0b2Zmc2V0ICs9IDE7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIG91dDtcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQodWludDgpIHtcblx0XHR2YXIgaSxcblx0XHRcdGV4dHJhQnl0ZXMgPSB1aW50OC5sZW5ndGggJSAzLCAvLyBpZiB3ZSBoYXZlIDEgYnl0ZSBsZWZ0LCBwYWQgMiBieXRlc1xuXHRcdFx0b3V0cHV0ID0gXCJcIixcblx0XHRcdHRlbXAsIGxlbmd0aDtcblxuXHRcdGZ1bmN0aW9uIHRyaXBsZXRUb0Jhc2U2NCAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwW251bSA+PiAxOCAmIDB4M0ZdICsgbG9va3VwW251bSA+PiAxMiAmIDB4M0ZdICsgbG9va3VwW251bSA+PiA2ICYgMHgzRl0gKyBsb29rdXBbbnVtICYgMHgzRl07XG5cdFx0fTtcblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pO1xuXHRcdFx0b3V0cHV0ICs9IHRyaXBsZXRUb0Jhc2U2NCh0ZW1wKTtcblx0XHR9XG5cblx0XHQvLyB0aGlzIHByZXZlbnRzIGFuIEVSUl9JTlZBTElEX1VSTCBpbiBDaHJvbWUgKEZpcmVmb3ggb2theSlcblx0XHRzd2l0Y2ggKG91dHB1dC5sZW5ndGggJSA0KSB7XG5cdFx0XHRjYXNlIDE6XG5cdFx0XHRcdG91dHB1dCArPSAnPSc7XG5cdFx0XHRcdGJyZWFrO1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHRvdXRwdXQgKz0gJz09Jztcblx0XHRcdFx0YnJlYWs7XG5cdFx0XHRkZWZhdWx0OlxuXHRcdFx0XHRicmVhaztcblx0XHR9XG5cblx0XHRyZXR1cm4gb3V0cHV0O1xuXHR9XG5cblx0d2luZG93LnV0aWxzID0ge31cblx0d2luZG93LnV0aWxzLmNsZWFuID0gY2xlYW47XG5cdHdpbmRvdy51dGlscy5wYWQgPSBwYWQ7XG5cdHdpbmRvdy51dGlscy5leHRlbmQgPSBleHRlbmQ7XG5cdHdpbmRvdy51dGlscy5zdHJpbmdUb1VpbnQ4ID0gc3RyaW5nVG9VaW50ODtcblx0d2luZG93LnV0aWxzLnVpbnQ4VG9CYXNlNjQgPSB1aW50OFRvQmFzZTY0O1xufSgpKTtcblxuKGZ1bmN0aW9uICgpIHtcblx0XCJ1c2Ugc3RyaWN0XCI7XG5cbi8qXG5zdHJ1Y3QgcG9zaXhfaGVhZGVyIHsgICAgICAgICAgICAgLy8gYnl0ZSBvZmZzZXRcblx0Y2hhciBuYW1lWzEwMF07ICAgICAgICAgICAgICAgLy8gICAwXG5cdGNoYXIgbW9kZVs4XTsgICAgICAgICAgICAgICAgIC8vIDEwMFxuXHRjaGFyIHVpZFs4XTsgICAgICAgICAgICAgICAgICAvLyAxMDhcblx0Y2hhciBnaWRbOF07ICAgICAgICAgICAgICAgICAgLy8gMTE2XG5cdGNoYXIgc2l6ZVsxMl07ICAgICAgICAgICAgICAgIC8vIDEyNFxuXHRjaGFyIG10aW1lWzEyXTsgICAgICAgICAgICAgICAvLyAxMzZcblx0Y2hhciBjaGtzdW1bOF07ICAgICAgICAgICAgICAgLy8gMTQ4XG5cdGNoYXIgdHlwZWZsYWc7ICAgICAgICAgICAgICAgIC8vIDE1NlxuXHRjaGFyIGxpbmtuYW1lWzEwMF07ICAgICAgICAgICAvLyAxNTdcblx0Y2hhciBtYWdpY1s2XTsgICAgICAgICAgICAgICAgLy8gMjU3XG5cdGNoYXIgdmVyc2lvblsyXTsgICAgICAgICAgICAgIC8vIDI2M1xuXHRjaGFyIHVuYW1lWzMyXTsgICAgICAgICAgICAgICAvLyAyNjVcblx0Y2hhciBnbmFtZVszMl07ICAgICAgICAgICAgICAgLy8gMjk3XG5cdGNoYXIgZGV2bWFqb3JbOF07ICAgICAgICAgICAgIC8vIDMyOVxuXHRjaGFyIGRldm1pbm9yWzhdOyAgICAgICAgICAgICAvLyAzMzdcblx0Y2hhciBwcmVmaXhbMTU1XTsgICAgICAgICAgICAgLy8gMzQ1XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gNTAwXG59O1xuKi9cblxuXHR2YXIgdXRpbHMgPSB3aW5kb3cudXRpbHMsXG5cdFx0aGVhZGVyRm9ybWF0O1xuXG5cdGhlYWRlckZvcm1hdCA9IFtcblx0XHR7XG5cdFx0XHQnZmllbGQnOiAnZmlsZU5hbWUnLFxuXHRcdFx0J2xlbmd0aCc6IDEwMFxuXHRcdH0sXG5cdFx0e1xuXHRcdFx0J2ZpZWxkJzogJ2ZpbGVNb2RlJyxcblx0XHRcdCdsZW5ndGgnOiA4XG5cdFx0fSxcblx0XHR7XG5cdFx0XHQnZmllbGQnOiAndWlkJyxcblx0XHRcdCdsZW5ndGgnOiA4XG5cdFx0fSxcblx0XHR7XG5cdFx0XHQnZmllbGQnOiAnZ2lkJyxcblx0XHRcdCdsZW5ndGgnOiA4XG5cdFx0fSxcblx0XHR7XG5cdFx0XHQnZmllbGQnOiAnZmlsZVNpemUnLFxuXHRcdFx0J2xlbmd0aCc6IDEyXG5cdFx0fSxcblx0XHR7XG5cdFx0XHQnZmllbGQnOiAnbXRpbWUnLFxuXHRcdFx0J2xlbmd0aCc6IDEyXG5cdFx0fSxcblx0XHR7XG5cdFx0XHQnZmllbGQnOiAnY2hlY2tzdW0nLFxuXHRcdFx0J2xlbmd0aCc6IDhcblx0XHR9LFxuXHRcdHtcblx0XHRcdCdmaWVsZCc6ICd0eXBlJyxcblx0XHRcdCdsZW5ndGgnOiAxXG5cdFx0fSxcblx0XHR7XG5cdFx0XHQnZmllbGQnOiAnbGlua05hbWUnLFxuXHRcdFx0J2xlbmd0aCc6IDEwMFxuXHRcdH0sXG5cdFx0e1xuXHRcdFx0J2ZpZWxkJzogJ3VzdGFyJyxcblx0XHRcdCdsZW5ndGgnOiA4XG5cdFx0fSxcblx0XHR7XG5cdFx0XHQnZmllbGQnOiAnb3duZXInLFxuXHRcdFx0J2xlbmd0aCc6IDMyXG5cdFx0fSxcblx0XHR7XG5cdFx0XHQnZmllbGQnOiAnZ3JvdXAnLFxuXHRcdFx0J2xlbmd0aCc6IDMyXG5cdFx0fSxcblx0XHR7XG5cdFx0XHQnZmllbGQnOiAnbWFqb3JOdW1iZXInLFxuXHRcdFx0J2xlbmd0aCc6IDhcblx0XHR9LFxuXHRcdHtcblx0XHRcdCdmaWVsZCc6ICdtaW5vck51bWJlcicsXG5cdFx0XHQnbGVuZ3RoJzogOFxuXHRcdH0sXG5cdFx0e1xuXHRcdFx0J2ZpZWxkJzogJ2ZpbGVuYW1lUHJlZml4Jyxcblx0XHRcdCdsZW5ndGgnOiAxNTVcblx0XHR9LFxuXHRcdHtcblx0XHRcdCdmaWVsZCc6ICdwYWRkaW5nJyxcblx0XHRcdCdsZW5ndGgnOiAxMlxuXHRcdH1cblx0XTtcblxuXHRmdW5jdGlvbiBmb3JtYXRIZWFkZXIoZGF0YSwgY2IpIHtcblx0XHR2YXIgYnVmZmVyID0gdXRpbHMuY2xlYW4oNTEyKSxcblx0XHRcdG9mZnNldCA9IDA7XG5cblx0XHRoZWFkZXJGb3JtYXQuZm9yRWFjaChmdW5jdGlvbiAodmFsdWUpIHtcblx0XHRcdHZhciBzdHIgPSBkYXRhW3ZhbHVlLmZpZWxkXSB8fCBcIlwiLFxuXHRcdFx0XHRpLCBsZW5ndGg7XG5cblx0XHRcdGZvciAoaSA9IDAsIGxlbmd0aCA9IHN0ci5sZW5ndGg7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuXHRcdFx0XHRidWZmZXJbb2Zmc2V0XSA9IHN0ci5jaGFyQ29kZUF0KGkpO1xuXHRcdFx0XHRvZmZzZXQgKz0gMTtcblx0XHRcdH1cblxuXHRcdFx0b2Zmc2V0ICs9IHZhbHVlLmxlbmd0aCAtIGk7IC8vIHNwYWNlIGl0IG91dCB3aXRoIG51bGxzXG5cdFx0fSk7XG5cblx0XHRpZiAodHlwZW9mIGNiID09PSAnZnVuY3Rpb24nKSB7XG5cdFx0XHRyZXR1cm4gY2IoYnVmZmVyLCBvZmZzZXQpO1xuXHRcdH1cblx0XHRyZXR1cm4gYnVmZmVyO1xuXHR9XG5cblx0d2luZG93LmhlYWRlciA9IHt9XG5cdHdpbmRvdy5oZWFkZXIuc3RydWN0dXJlID0gaGVhZGVyRm9ybWF0O1xuXHR3aW5kb3cuaGVhZGVyLmZvcm1hdCA9IGZvcm1hdEhlYWRlcjtcbn0oKSk7XG5cbihmdW5jdGlvbiAoKSB7XG5cdFwidXNlIHN0cmljdFwiO1xuXG5cdHZhciBoZWFkZXIgPSB3aW5kb3cuaGVhZGVyLFxuXHRcdHV0aWxzID0gd2luZG93LnV0aWxzLFxuXHRcdHJlY29yZFNpemUgPSA1MTIsXG5cdFx0YmxvY2tTaXplO1xuXG5cdGZ1bmN0aW9uIFRhcihyZWNvcmRzUGVyQmxvY2spIHtcblx0XHR0aGlzLndyaXR0ZW4gPSAwO1xuXHRcdGJsb2NrU2l6ZSA9IChyZWNvcmRzUGVyQmxvY2sgfHwgMjApICogcmVjb3JkU2l6ZTtcblx0XHR0aGlzLm91dCA9IHV0aWxzLmNsZWFuKGJsb2NrU2l6ZSk7XG5cdFx0dGhpcy5ibG9ja3MgPSBbXTtcblx0XHR0aGlzLmxlbmd0aCA9IDA7XG5cdH1cblxuXHRUYXIucHJvdG90eXBlLmFwcGVuZCA9IGZ1bmN0aW9uIChmaWxlcGF0aCwgaW5wdXQsIG9wdHMsIGNhbGxiYWNrKSB7XG5cdFx0dmFyIGRhdGEsXG5cdFx0XHRjaGVja3N1bSxcblx0XHRcdG1vZGUsXG5cdFx0XHRtdGltZSxcblx0XHRcdHVpZCxcblx0XHRcdGdpZCxcblx0XHRcdGhlYWRlckFycjtcblxuXHRcdGlmICh0eXBlb2YgaW5wdXQgPT09ICdzdHJpbmcnKSB7XG5cdFx0XHRpbnB1dCA9IHV0aWxzLnN0cmluZ1RvVWludDgoaW5wdXQpO1xuXHRcdH0gZWxzZSBpZiAoaW5wdXQuY29uc3RydWN0b3IgIT09IFVpbnQ4QXJyYXkucHJvdG90eXBlLmNvbnN0cnVjdG9yKSB7XG5cdFx0XHR0aHJvdyAnSW52YWxpZCBpbnB1dCB0eXBlLiBZb3UgZ2F2ZSBtZTogJyArIGlucHV0LmNvbnN0cnVjdG9yLnRvU3RyaW5nKCkubWF0Y2goL2Z1bmN0aW9uXFxzKihbJEEtWmEtel9dWzAtOUEtWmEtel9dKilcXHMqXFwoLylbMV07XG5cdFx0fVxuXG5cdFx0aWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG5cdFx0XHRjYWxsYmFjayA9IG9wdHM7XG5cdFx0XHRvcHRzID0ge307XG5cdFx0fVxuXG5cdFx0b3B0cyA9IG9wdHMgfHwge307XG5cblx0XHRtb2RlID0gb3B0cy5tb2RlIHx8IHBhcnNlSW50KCc3NzcnLCA4KSAmIDB4ZmZmO1xuXHRcdG10aW1lID0gb3B0cy5tdGltZSB8fCBNYXRoLmZsb29yKCtuZXcgRGF0ZSgpIC8gMTAwMCk7XG5cdFx0dWlkID0gb3B0cy51aWQgfHwgMDtcblx0XHRnaWQgPSBvcHRzLmdpZCB8fCAwO1xuXG5cdFx0ZGF0YSA9IHtcblx0XHRcdGZpbGVOYW1lOiBmaWxlcGF0aCxcblx0XHRcdGZpbGVNb2RlOiB1dGlscy5wYWQobW9kZSwgNyksXG5cdFx0XHR1aWQ6IHV0aWxzLnBhZCh1aWQsIDcpLFxuXHRcdFx0Z2lkOiB1dGlscy5wYWQoZ2lkLCA3KSxcblx0XHRcdGZpbGVTaXplOiB1dGlscy5wYWQoaW5wdXQubGVuZ3RoLCAxMSksXG5cdFx0XHRtdGltZTogdXRpbHMucGFkKG10aW1lLCAxMSksXG5cdFx0XHRjaGVja3N1bTogJyAgICAgICAgJyxcblx0XHRcdHR5cGU6ICcwJywgLy8ganVzdCBhIGZpbGVcblx0XHRcdHVzdGFyOiAndXN0YXIgICcsXG5cdFx0XHRvd25lcjogb3B0cy5vd25lciB8fCAnJyxcblx0XHRcdGdyb3VwOiBvcHRzLmdyb3VwIHx8ICcnXG5cdFx0fTtcblxuXHRcdC8vIGNhbGN1bGF0ZSB0aGUgY2hlY2tzdW1cblx0XHRjaGVja3N1bSA9IDA7XG5cdFx0T2JqZWN0LmtleXMoZGF0YSkuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XG5cdFx0XHR2YXIgaSwgdmFsdWUgPSBkYXRhW2tleV0sIGxlbmd0aDtcblxuXHRcdFx0Zm9yIChpID0gMCwgbGVuZ3RoID0gdmFsdWUubGVuZ3RoOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcblx0XHRcdFx0Y2hlY2tzdW0gKz0gdmFsdWUuY2hhckNvZGVBdChpKTtcblx0XHRcdH1cblx0XHR9KTtcblxuXHRcdGRhdGEuY2hlY2tzdW0gPSB1dGlscy5wYWQoY2hlY2tzdW0sIDYpICsgXCJcXHUwMDAwIFwiO1xuXG5cdFx0aGVhZGVyQXJyID0gaGVhZGVyLmZvcm1hdChkYXRhKTtcblxuXHRcdHZhciBoZWFkZXJMZW5ndGggPSBNYXRoLmNlaWwoIGhlYWRlckFyci5sZW5ndGggLyByZWNvcmRTaXplICkgKiByZWNvcmRTaXplO1xuXHRcdHZhciBpbnB1dExlbmd0aCA9IE1hdGguY2VpbCggaW5wdXQubGVuZ3RoIC8gcmVjb3JkU2l6ZSApICogcmVjb3JkU2l6ZTtcblxuXHRcdHRoaXMuYmxvY2tzLnB1c2goIHsgaGVhZGVyOiBoZWFkZXJBcnIsIGlucHV0OiBpbnB1dCwgaGVhZGVyTGVuZ3RoOiBoZWFkZXJMZW5ndGgsIGlucHV0TGVuZ3RoOiBpbnB1dExlbmd0aCB9ICk7XG5cblx0fTtcblxuXHRUYXIucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbigpIHtcblxuXHRcdHZhciBidWZmZXJzID0gW107XG5cdFx0dmFyIGNodW5rcyA9IFtdO1xuXHRcdHZhciBsZW5ndGggPSAwO1xuXHRcdHZhciBtYXggPSBNYXRoLnBvdyggMiwgMjAgKTtcblxuXHRcdHZhciBjaHVuayA9IFtdO1xuXHRcdHRoaXMuYmxvY2tzLmZvckVhY2goIGZ1bmN0aW9uKCBiICkge1xuXHRcdFx0aWYoIGxlbmd0aCArIGIuaGVhZGVyTGVuZ3RoICsgYi5pbnB1dExlbmd0aCA+IG1heCApIHtcblx0XHRcdFx0Y2h1bmtzLnB1c2goIHsgYmxvY2tzOiBjaHVuaywgbGVuZ3RoOiBsZW5ndGggfSApO1xuXHRcdFx0XHRjaHVuayA9IFtdO1xuXHRcdFx0XHRsZW5ndGggPSAwO1xuXHRcdFx0fVxuXHRcdFx0Y2h1bmsucHVzaCggYiApO1xuXHRcdFx0bGVuZ3RoICs9IGIuaGVhZGVyTGVuZ3RoICsgYi5pbnB1dExlbmd0aDtcblx0XHR9ICk7XG5cdFx0Y2h1bmtzLnB1c2goIHsgYmxvY2tzOiBjaHVuaywgbGVuZ3RoOiBsZW5ndGggfSApO1xuXG5cdFx0Y2h1bmtzLmZvckVhY2goIGZ1bmN0aW9uKCBjICkge1xuXG5cdFx0XHR2YXIgYnVmZmVyID0gbmV3IFVpbnQ4QXJyYXkoIGMubGVuZ3RoICk7XG5cdFx0XHR2YXIgd3JpdHRlbiA9IDA7XG5cdFx0XHRjLmJsb2Nrcy5mb3JFYWNoKCBmdW5jdGlvbiggYiApIHtcblx0XHRcdFx0YnVmZmVyLnNldCggYi5oZWFkZXIsIHdyaXR0ZW4gKTtcblx0XHRcdFx0d3JpdHRlbiArPSBiLmhlYWRlckxlbmd0aDtcblx0XHRcdFx0YnVmZmVyLnNldCggYi5pbnB1dCwgd3JpdHRlbiApO1xuXHRcdFx0XHR3cml0dGVuICs9IGIuaW5wdXRMZW5ndGg7XG5cdFx0XHR9ICk7XG5cdFx0XHRidWZmZXJzLnB1c2goIGJ1ZmZlciApO1xuXG5cdFx0fSApO1xuXG5cdFx0YnVmZmVycy5wdXNoKCBuZXcgVWludDhBcnJheSggMiAqIHJlY29yZFNpemUgKSApO1xuXG5cdFx0cmV0dXJuIG5ldyBCbG9iKCBidWZmZXJzLCB7IHR5cGU6ICdvY3RldC9zdHJlYW0nIH0gKTtcblxuXHR9O1xuXG5cdFRhci5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbiAoKSB7XG5cdFx0dGhpcy53cml0dGVuID0gMDtcblx0XHR0aGlzLm91dCA9IHV0aWxzLmNsZWFuKGJsb2NrU2l6ZSk7XG5cdH07XG5cbiAgaWYgKHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiBtb2R1bGUuZXhwb3J0cyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IFRhcjtcbiAgfSBlbHNlIHtcbiAgICB3aW5kb3cuVGFyID0gVGFyO1xuICB9XG59KCkpO1xuIiwiLy9kb3dubG9hZC5qcyB2My4wLCBieSBkYW5kYXZpczsgMjAwOC0yMDE0LiBbQ0NCWTJdIHNlZSBodHRwOi8vZGFubWwuY29tL2Rvd25sb2FkLmh0bWwgZm9yIHRlc3RzL3VzYWdlXG4vLyB2MSBsYW5kZWQgYSBGRitDaHJvbWUgY29tcGF0IHdheSBvZiBkb3dubG9hZGluZyBzdHJpbmdzIHRvIGxvY2FsIHVuLW5hbWVkIGZpbGVzLCB1cGdyYWRlZCB0byB1c2UgYSBoaWRkZW4gZnJhbWUgYW5kIG9wdGlvbmFsIG1pbWVcbi8vIHYyIGFkZGVkIG5hbWVkIGZpbGVzIHZpYSBhW2Rvd25sb2FkXSwgbXNTYXZlQmxvYiwgSUUgKDEwKykgc3VwcG9ydCwgYW5kIHdpbmRvdy5VUkwgc3VwcG9ydCBmb3IgbGFyZ2VyK2Zhc3RlciBzYXZlcyB0aGFuIGRhdGFVUkxzXG4vLyB2MyBhZGRlZCBkYXRhVVJMIGFuZCBCbG9iIElucHV0LCBiaW5kLXRvZ2dsZSBhcml0eSwgYW5kIGxlZ2FjeSBkYXRhVVJMIGZhbGxiYWNrIHdhcyBpbXByb3ZlZCB3aXRoIGZvcmNlLWRvd25sb2FkIG1pbWUgYW5kIGJhc2U2NCBzdXBwb3J0XG5cbi8vIGRhdGEgY2FuIGJlIGEgc3RyaW5nLCBCbG9iLCBGaWxlLCBvciBkYXRhVVJMXG5cblxuXG5cbmZ1bmN0aW9uIGRvd25sb2FkKGRhdGEsIHN0ckZpbGVOYW1lLCBzdHJNaW1lVHlwZSkge1xuXG5cdHZhciBzZWxmID0gd2luZG93LCAvLyB0aGlzIHNjcmlwdCBpcyBvbmx5IGZvciBicm93c2VycyBhbnl3YXkuLi5cblx0XHR1ID0gXCJhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW1cIiwgLy8gdGhpcyBkZWZhdWx0IG1pbWUgYWxzbyB0cmlnZ2VycyBpZnJhbWUgZG93bmxvYWRzXG5cdFx0bSA9IHN0ck1pbWVUeXBlIHx8IHUsXG5cdFx0eCA9IGRhdGEsXG5cdFx0RCA9IGRvY3VtZW50LFxuXHRcdGEgPSBELmNyZWF0ZUVsZW1lbnQoXCJhXCIpLFxuXHRcdHogPSBmdW5jdGlvbihhKXtyZXR1cm4gU3RyaW5nKGEpO30sXG5cblxuXHRcdEIgPSBzZWxmLkJsb2IgfHwgc2VsZi5Nb3pCbG9iIHx8IHNlbGYuV2ViS2l0QmxvYiB8fCB6LFxuXHRcdEJCID0gc2VsZi5NU0Jsb2JCdWlsZGVyIHx8IHNlbGYuV2ViS2l0QmxvYkJ1aWxkZXIgfHwgc2VsZi5CbG9iQnVpbGRlcixcblx0XHRmbiA9IHN0ckZpbGVOYW1lIHx8IFwiZG93bmxvYWRcIixcblx0XHRibG9iLFxuXHRcdGIsXG5cdFx0dWEsXG5cdFx0ZnI7XG5cblx0Ly9pZih0eXBlb2YgQi5iaW5kID09PSAnZnVuY3Rpb24nICl7IEI9Qi5iaW5kKHNlbGYpOyB9XG5cblx0aWYoU3RyaW5nKHRoaXMpPT09XCJ0cnVlXCIpeyAvL3JldmVyc2UgYXJndW1lbnRzLCBhbGxvd2luZyBkb3dubG9hZC5iaW5kKHRydWUsIFwidGV4dC94bWxcIiwgXCJleHBvcnQueG1sXCIpIHRvIGFjdCBhcyBhIGNhbGxiYWNrXG5cdFx0eD1beCwgbV07XG5cdFx0bT14WzBdO1xuXHRcdHg9eFsxXTtcblx0fVxuXG5cblxuXHQvL2dvIGFoZWFkIGFuZCBkb3dubG9hZCBkYXRhVVJMcyByaWdodCBhd2F5XG5cdGlmKFN0cmluZyh4KS5tYXRjaCgvXmRhdGFcXDpbXFx3K1xcLV0rXFwvW1xcdytcXC1dK1ssO10vKSl7XG5cdFx0cmV0dXJuIG5hdmlnYXRvci5tc1NhdmVCbG9iID8gIC8vIElFMTAgY2FuJ3QgZG8gYVtkb3dubG9hZF0sIG9ubHkgQmxvYnM6XG5cdFx0XHRuYXZpZ2F0b3IubXNTYXZlQmxvYihkMmIoeCksIGZuKSA6XG5cdFx0XHRzYXZlcih4KSA7IC8vIGV2ZXJ5b25lIGVsc2UgY2FuIHNhdmUgZGF0YVVSTHMgdW4tcHJvY2Vzc2VkXG5cdH0vL2VuZCBpZiBkYXRhVVJMIHBhc3NlZD9cblxuXHR0cnl7XG5cblx0XHRibG9iID0geCBpbnN0YW5jZW9mIEIgP1xuXHRcdFx0eCA6XG5cdFx0XHRuZXcgQihbeF0sIHt0eXBlOiBtfSkgO1xuXHR9Y2F0Y2goeSl7XG5cdFx0aWYoQkIpe1xuXHRcdFx0YiA9IG5ldyBCQigpO1xuXHRcdFx0Yi5hcHBlbmQoW3hdKTtcblx0XHRcdGJsb2IgPSBiLmdldEJsb2IobSk7IC8vIHRoZSBibG9iXG5cdFx0fVxuXG5cdH1cblxuXG5cblx0ZnVuY3Rpb24gZDJiKHUpIHtcblx0XHR2YXIgcD0gdS5zcGxpdCgvWzo7LF0vKSxcblx0XHR0PSBwWzFdLFxuXHRcdGRlYz0gcFsyXSA9PSBcImJhc2U2NFwiID8gYXRvYiA6IGRlY29kZVVSSUNvbXBvbmVudCxcblx0XHRiaW49IGRlYyhwLnBvcCgpKSxcblx0XHRteD0gYmluLmxlbmd0aCxcblx0XHRpPSAwLFxuXHRcdHVpYT0gbmV3IFVpbnQ4QXJyYXkobXgpO1xuXG5cdFx0Zm9yKGk7aTxteDsrK2kpIHVpYVtpXT0gYmluLmNoYXJDb2RlQXQoaSk7XG5cblx0XHRyZXR1cm4gbmV3IEIoW3VpYV0sIHt0eXBlOiB0fSk7XG5cdCB9XG5cblx0ZnVuY3Rpb24gc2F2ZXIodXJsLCB3aW5Nb2RlKXtcblxuXG5cdFx0aWYgKCdkb3dubG9hZCcgaW4gYSkgeyAvL2h0bWw1IEFbZG93bmxvYWRdXG5cdFx0XHRhLmhyZWYgPSB1cmw7XG5cdFx0XHRhLnNldEF0dHJpYnV0ZShcImRvd25sb2FkXCIsIGZuKTtcblx0XHRcdGEuaW5uZXJIVE1MID0gXCJkb3dubG9hZGluZy4uLlwiO1xuXHRcdFx0YS5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuXHRcdFx0RC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuXHRcdFx0c2V0VGltZW91dChmdW5jdGlvbigpIHtcblx0XHRcdFx0YS5jbGljaygpO1xuXHRcdFx0XHRELmJvZHkucmVtb3ZlQ2hpbGQoYSk7XG5cdFx0XHRcdGlmKHdpbk1vZGU9PT10cnVlKXtzZXRUaW1lb3V0KGZ1bmN0aW9uKCl7IHNlbGYuVVJMLnJldm9rZU9iamVjdFVSTChhLmhyZWYpO30sIDI1MCApO31cblx0XHRcdH0sIDY2KTtcblx0XHRcdHJldHVybiB0cnVlO1xuXHRcdH1cblxuXHRcdC8vZG8gaWZyYW1lIGRhdGFVUkwgZG93bmxvYWQgKG9sZCBjaCtGRik6XG5cdFx0dmFyIGYgPSBELmNyZWF0ZUVsZW1lbnQoXCJpZnJhbWVcIik7XG5cdFx0RC5ib2R5LmFwcGVuZENoaWxkKGYpO1xuXHRcdGlmKCF3aW5Nb2RlKXsgLy8gZm9yY2UgYSBtaW1lIHRoYXQgd2lsbCBkb3dubG9hZDpcblx0XHRcdHVybD1cImRhdGE6XCIrdXJsLnJlcGxhY2UoL15kYXRhOihbXFx3XFwvXFwtXFwrXSspLywgdSk7XG5cdFx0fVxuXG5cblx0XHRmLnNyYyA9IHVybDtcblx0XHRzZXRUaW1lb3V0KGZ1bmN0aW9uKCl7IEQuYm9keS5yZW1vdmVDaGlsZChmKTsgfSwgMzMzKTtcblxuXHR9Ly9lbmQgc2F2ZXJcblxuXG5cdGlmIChuYXZpZ2F0b3IubXNTYXZlQmxvYikgeyAvLyBJRTEwKyA6IChoYXMgQmxvYiwgYnV0IG5vdCBhW2Rvd25sb2FkXSBvciBVUkwpXG5cdFx0cmV0dXJuIG5hdmlnYXRvci5tc1NhdmVCbG9iKGJsb2IsIGZuKTtcblx0fVxuXG5cdGlmKHNlbGYuVVJMKXsgLy8gc2ltcGxlIGZhc3QgYW5kIG1vZGVybiB3YXkgdXNpbmcgQmxvYiBhbmQgVVJMOlxuXHRcdHNhdmVyKHNlbGYuVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKSwgdHJ1ZSk7XG5cdH1lbHNle1xuXHRcdC8vIGhhbmRsZSBub24tQmxvYigpK25vbi1VUkwgYnJvd3NlcnM6XG5cdFx0aWYodHlwZW9mIGJsb2IgPT09IFwic3RyaW5nXCIgfHwgYmxvYi5jb25zdHJ1Y3Rvcj09PXogKXtcblx0XHRcdHRyeXtcblx0XHRcdFx0cmV0dXJuIHNhdmVyKCBcImRhdGE6XCIgKyAgbSAgICsgXCI7YmFzZTY0LFwiICArICBzZWxmLmJ0b2EoYmxvYikgICk7XG5cdFx0XHR9Y2F0Y2goeSl7XG5cdFx0XHRcdHJldHVybiBzYXZlciggXCJkYXRhOlwiICsgIG0gICArIFwiLFwiICsgZW5jb2RlVVJJQ29tcG9uZW50KGJsb2IpICApO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdC8vIEJsb2IgYnV0IG5vdCBVUkw6XG5cdFx0ZnI9bmV3IEZpbGVSZWFkZXIoKTtcblx0XHRmci5vbmxvYWQ9ZnVuY3Rpb24oZSl7XG5cdFx0XHRzYXZlcih0aGlzLnJlc3VsdCk7XG5cdFx0fTtcblx0XHRmci5yZWFkQXNEYXRhVVJMKGJsb2IpO1xuXHR9XG5cdHJldHVybiB0cnVlO1xufSAvKiBlbmQgZG93bmxvYWQoKSAqL1xuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIG1vZHVsZS5leHBvcnRzICE9PSAndW5kZWZpbmVkJykge1xuICBtb2R1bGUuZXhwb3J0cyA9IGRvd25sb2FkO1xufVxuIiwiLy8gZ2lmLmpzIDAuMi4wIC0gaHR0cHM6Ly9naXRodWIuY29tL2pub3JkYmVyZy9naWYuanNcclxuKGZ1bmN0aW9uKGYpe2lmKHR5cGVvZiBleHBvcnRzPT09XCJvYmplY3RcIiYmdHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCIpe21vZHVsZS5leHBvcnRzPWYoKX1lbHNlIGlmKHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJmRlZmluZS5hbWQpe2RlZmluZShbXSxmKX1lbHNle3ZhciBnO2lmKHR5cGVvZiB3aW5kb3chPT1cInVuZGVmaW5lZFwiKXtnPXdpbmRvd31lbHNlIGlmKHR5cGVvZiBnbG9iYWwhPT1cInVuZGVmaW5lZFwiKXtnPWdsb2JhbH1lbHNlIGlmKHR5cGVvZiBzZWxmIT09XCJ1bmRlZmluZWRcIil7Zz1zZWxmfWVsc2V7Zz10aGlzfWcuR0lGPWYoKX19KShmdW5jdGlvbigpe3ZhciBkZWZpbmUsbW9kdWxlLGV4cG9ydHM7cmV0dXJuIGZ1bmN0aW9uKCl7ZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9cmV0dXJuIGV9KCkoezE6W2Z1bmN0aW9uKHJlcXVpcmUsbW9kdWxlLGV4cG9ydHMpe2Z1bmN0aW9uIEV2ZW50RW1pdHRlcigpe3RoaXMuX2V2ZW50cz10aGlzLl9ldmVudHN8fHt9O3RoaXMuX21heExpc3RlbmVycz10aGlzLl9tYXhMaXN0ZW5lcnN8fHVuZGVmaW5lZH1tb2R1bGUuZXhwb3J0cz1FdmVudEVtaXR0ZXI7RXZlbnRFbWl0dGVyLkV2ZW50RW1pdHRlcj1FdmVudEVtaXR0ZXI7RXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fZXZlbnRzPXVuZGVmaW5lZDtFdmVudEVtaXR0ZXIucHJvdG90eXBlLl9tYXhMaXN0ZW5lcnM9dW5kZWZpbmVkO0V2ZW50RW1pdHRlci5kZWZhdWx0TWF4TGlzdGVuZXJzPTEwO0V2ZW50RW1pdHRlci5wcm90b3R5cGUuc2V0TWF4TGlzdGVuZXJzPWZ1bmN0aW9uKG4pe2lmKCFpc051bWJlcihuKXx8bjwwfHxpc05hTihuKSl0aHJvdyBUeXBlRXJyb3IoXCJuIG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXJcIik7dGhpcy5fbWF4TGlzdGVuZXJzPW47cmV0dXJuIHRoaXN9O0V2ZW50RW1pdHRlci5wcm90b3R5cGUuZW1pdD1mdW5jdGlvbih0eXBlKXt2YXIgZXIsaGFuZGxlcixsZW4sYXJncyxpLGxpc3RlbmVycztpZighdGhpcy5fZXZlbnRzKXRoaXMuX2V2ZW50cz17fTtpZih0eXBlPT09XCJlcnJvclwiKXtpZighdGhpcy5fZXZlbnRzLmVycm9yfHxpc09iamVjdCh0aGlzLl9ldmVudHMuZXJyb3IpJiYhdGhpcy5fZXZlbnRzLmVycm9yLmxlbmd0aCl7ZXI9YXJndW1lbnRzWzFdO2lmKGVyIGluc3RhbmNlb2YgRXJyb3Ipe3Rocm93IGVyfWVsc2V7dmFyIGVycj1uZXcgRXJyb3IoJ1VuY2F1Z2h0LCB1bnNwZWNpZmllZCBcImVycm9yXCIgZXZlbnQuICgnK2VyK1wiKVwiKTtlcnIuY29udGV4dD1lcjt0aHJvdyBlcnJ9fX1oYW5kbGVyPXRoaXMuX2V2ZW50c1t0eXBlXTtpZihpc1VuZGVmaW5lZChoYW5kbGVyKSlyZXR1cm4gZmFsc2U7aWYoaXNGdW5jdGlvbihoYW5kbGVyKSl7c3dpdGNoKGFyZ3VtZW50cy5sZW5ndGgpe2Nhc2UgMTpoYW5kbGVyLmNhbGwodGhpcyk7YnJlYWs7Y2FzZSAyOmhhbmRsZXIuY2FsbCh0aGlzLGFyZ3VtZW50c1sxXSk7YnJlYWs7Y2FzZSAzOmhhbmRsZXIuY2FsbCh0aGlzLGFyZ3VtZW50c1sxXSxhcmd1bWVudHNbMl0pO2JyZWFrO2RlZmF1bHQ6YXJncz1BcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsMSk7aGFuZGxlci5hcHBseSh0aGlzLGFyZ3MpfX1lbHNlIGlmKGlzT2JqZWN0KGhhbmRsZXIpKXthcmdzPUFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywxKTtsaXN0ZW5lcnM9aGFuZGxlci5zbGljZSgpO2xlbj1saXN0ZW5lcnMubGVuZ3RoO2ZvcihpPTA7aTxsZW47aSsrKWxpc3RlbmVyc1tpXS5hcHBseSh0aGlzLGFyZ3MpfXJldHVybiB0cnVlfTtFdmVudEVtaXR0ZXIucHJvdG90eXBlLmFkZExpc3RlbmVyPWZ1bmN0aW9uKHR5cGUsbGlzdGVuZXIpe3ZhciBtO2lmKCFpc0Z1bmN0aW9uKGxpc3RlbmVyKSl0aHJvdyBUeXBlRXJyb3IoXCJsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb25cIik7aWYoIXRoaXMuX2V2ZW50cyl0aGlzLl9ldmVudHM9e307aWYodGhpcy5fZXZlbnRzLm5ld0xpc3RlbmVyKXRoaXMuZW1pdChcIm5ld0xpc3RlbmVyXCIsdHlwZSxpc0Z1bmN0aW9uKGxpc3RlbmVyLmxpc3RlbmVyKT9saXN0ZW5lci5saXN0ZW5lcjpsaXN0ZW5lcik7aWYoIXRoaXMuX2V2ZW50c1t0eXBlXSl0aGlzLl9ldmVudHNbdHlwZV09bGlzdGVuZXI7ZWxzZSBpZihpc09iamVjdCh0aGlzLl9ldmVudHNbdHlwZV0pKXRoaXMuX2V2ZW50c1t0eXBlXS5wdXNoKGxpc3RlbmVyKTtlbHNlIHRoaXMuX2V2ZW50c1t0eXBlXT1bdGhpcy5fZXZlbnRzW3R5cGVdLGxpc3RlbmVyXTtpZihpc09iamVjdCh0aGlzLl9ldmVudHNbdHlwZV0pJiYhdGhpcy5fZXZlbnRzW3R5cGVdLndhcm5lZCl7aWYoIWlzVW5kZWZpbmVkKHRoaXMuX21heExpc3RlbmVycykpe209dGhpcy5fbWF4TGlzdGVuZXJzfWVsc2V7bT1FdmVudEVtaXR0ZXIuZGVmYXVsdE1heExpc3RlbmVyc31pZihtJiZtPjAmJnRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGg+bSl7dGhpcy5fZXZlbnRzW3R5cGVdLndhcm5lZD10cnVlO2NvbnNvbGUuZXJyb3IoXCIobm9kZSkgd2FybmluZzogcG9zc2libGUgRXZlbnRFbWl0dGVyIG1lbW9yeSBcIitcImxlYWsgZGV0ZWN0ZWQuICVkIGxpc3RlbmVycyBhZGRlZC4gXCIrXCJVc2UgZW1pdHRlci5zZXRNYXhMaXN0ZW5lcnMoKSB0byBpbmNyZWFzZSBsaW1pdC5cIix0aGlzLl9ldmVudHNbdHlwZV0ubGVuZ3RoKTtpZih0eXBlb2YgY29uc29sZS50cmFjZT09PVwiZnVuY3Rpb25cIil7Y29uc29sZS50cmFjZSgpfX19cmV0dXJuIHRoaXN9O0V2ZW50RW1pdHRlci5wcm90b3R5cGUub249RXZlbnRFbWl0dGVyLnByb3RvdHlwZS5hZGRMaXN0ZW5lcjtFdmVudEVtaXR0ZXIucHJvdG90eXBlLm9uY2U9ZnVuY3Rpb24odHlwZSxsaXN0ZW5lcil7aWYoIWlzRnVuY3Rpb24obGlzdGVuZXIpKXRocm93IFR5cGVFcnJvcihcImxpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvblwiKTt2YXIgZmlyZWQ9ZmFsc2U7ZnVuY3Rpb24gZygpe3RoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSxnKTtpZighZmlyZWQpe2ZpcmVkPXRydWU7bGlzdGVuZXIuYXBwbHkodGhpcyxhcmd1bWVudHMpfX1nLmxpc3RlbmVyPWxpc3RlbmVyO3RoaXMub24odHlwZSxnKTtyZXR1cm4gdGhpc307RXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVMaXN0ZW5lcj1mdW5jdGlvbih0eXBlLGxpc3RlbmVyKXt2YXIgbGlzdCxwb3NpdGlvbixsZW5ndGgsaTtpZighaXNGdW5jdGlvbihsaXN0ZW5lcikpdGhyb3cgVHlwZUVycm9yKFwibGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uXCIpO2lmKCF0aGlzLl9ldmVudHN8fCF0aGlzLl9ldmVudHNbdHlwZV0pcmV0dXJuIHRoaXM7bGlzdD10aGlzLl9ldmVudHNbdHlwZV07bGVuZ3RoPWxpc3QubGVuZ3RoO3Bvc2l0aW9uPS0xO2lmKGxpc3Q9PT1saXN0ZW5lcnx8aXNGdW5jdGlvbihsaXN0Lmxpc3RlbmVyKSYmbGlzdC5saXN0ZW5lcj09PWxpc3RlbmVyKXtkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO2lmKHRoaXMuX2V2ZW50cy5yZW1vdmVMaXN0ZW5lcil0aGlzLmVtaXQoXCJyZW1vdmVMaXN0ZW5lclwiLHR5cGUsbGlzdGVuZXIpfWVsc2UgaWYoaXNPYmplY3QobGlzdCkpe2ZvcihpPWxlbmd0aDtpLS0gPjA7KXtpZihsaXN0W2ldPT09bGlzdGVuZXJ8fGxpc3RbaV0ubGlzdGVuZXImJmxpc3RbaV0ubGlzdGVuZXI9PT1saXN0ZW5lcil7cG9zaXRpb249aTticmVha319aWYocG9zaXRpb248MClyZXR1cm4gdGhpcztpZihsaXN0Lmxlbmd0aD09PTEpe2xpc3QubGVuZ3RoPTA7ZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXX1lbHNle2xpc3Quc3BsaWNlKHBvc2l0aW9uLDEpfWlmKHRoaXMuX2V2ZW50cy5yZW1vdmVMaXN0ZW5lcil0aGlzLmVtaXQoXCJyZW1vdmVMaXN0ZW5lclwiLHR5cGUsbGlzdGVuZXIpfXJldHVybiB0aGlzfTtFdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUFsbExpc3RlbmVycz1mdW5jdGlvbih0eXBlKXt2YXIga2V5LGxpc3RlbmVycztpZighdGhpcy5fZXZlbnRzKXJldHVybiB0aGlzO2lmKCF0aGlzLl9ldmVudHMucmVtb3ZlTGlzdGVuZXIpe2lmKGFyZ3VtZW50cy5sZW5ndGg9PT0wKXRoaXMuX2V2ZW50cz17fTtlbHNlIGlmKHRoaXMuX2V2ZW50c1t0eXBlXSlkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO3JldHVybiB0aGlzfWlmKGFyZ3VtZW50cy5sZW5ndGg9PT0wKXtmb3Ioa2V5IGluIHRoaXMuX2V2ZW50cyl7aWYoa2V5PT09XCJyZW1vdmVMaXN0ZW5lclwiKWNvbnRpbnVlO3RoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKGtleSl9dGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMoXCJyZW1vdmVMaXN0ZW5lclwiKTt0aGlzLl9ldmVudHM9e307cmV0dXJuIHRoaXN9bGlzdGVuZXJzPXRoaXMuX2V2ZW50c1t0eXBlXTtpZihpc0Z1bmN0aW9uKGxpc3RlbmVycykpe3RoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSxsaXN0ZW5lcnMpfWVsc2UgaWYobGlzdGVuZXJzKXt3aGlsZShsaXN0ZW5lcnMubGVuZ3RoKXRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSxsaXN0ZW5lcnNbbGlzdGVuZXJzLmxlbmd0aC0xXSl9ZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtyZXR1cm4gdGhpc307RXZlbnRFbWl0dGVyLnByb3RvdHlwZS5saXN0ZW5lcnM9ZnVuY3Rpb24odHlwZSl7dmFyIHJldDtpZighdGhpcy5fZXZlbnRzfHwhdGhpcy5fZXZlbnRzW3R5cGVdKXJldD1bXTtlbHNlIGlmKGlzRnVuY3Rpb24odGhpcy5fZXZlbnRzW3R5cGVdKSlyZXQ9W3RoaXMuX2V2ZW50c1t0eXBlXV07ZWxzZSByZXQ9dGhpcy5fZXZlbnRzW3R5cGVdLnNsaWNlKCk7cmV0dXJuIHJldH07RXZlbnRFbWl0dGVyLnByb3RvdHlwZS5saXN0ZW5lckNvdW50PWZ1bmN0aW9uKHR5cGUpe2lmKHRoaXMuX2V2ZW50cyl7dmFyIGV2bGlzdGVuZXI9dGhpcy5fZXZlbnRzW3R5cGVdO2lmKGlzRnVuY3Rpb24oZXZsaXN0ZW5lcikpcmV0dXJuIDE7ZWxzZSBpZihldmxpc3RlbmVyKXJldHVybiBldmxpc3RlbmVyLmxlbmd0aH1yZXR1cm4gMH07RXZlbnRFbWl0dGVyLmxpc3RlbmVyQ291bnQ9ZnVuY3Rpb24oZW1pdHRlcix0eXBlKXtyZXR1cm4gZW1pdHRlci5saXN0ZW5lckNvdW50KHR5cGUpfTtmdW5jdGlvbiBpc0Z1bmN0aW9uKGFyZyl7cmV0dXJuIHR5cGVvZiBhcmc9PT1cImZ1bmN0aW9uXCJ9ZnVuY3Rpb24gaXNOdW1iZXIoYXJnKXtyZXR1cm4gdHlwZW9mIGFyZz09PVwibnVtYmVyXCJ9ZnVuY3Rpb24gaXNPYmplY3QoYXJnKXtyZXR1cm4gdHlwZW9mIGFyZz09PVwib2JqZWN0XCImJmFyZyE9PW51bGx9ZnVuY3Rpb24gaXNVbmRlZmluZWQoYXJnKXtyZXR1cm4gYXJnPT09dm9pZCAwfX0se31dLDI6W2Z1bmN0aW9uKHJlcXVpcmUsbW9kdWxlLGV4cG9ydHMpe3ZhciBOZXVRdWFudD1yZXF1aXJlKFwiLi9UeXBlZE5ldVF1YW50LmpzXCIpO3ZhciBMWldFbmNvZGVyPXJlcXVpcmUoXCIuL0xaV0VuY29kZXIuanNcIik7ZnVuY3Rpb24gQnl0ZUFycmF5KCl7dGhpcy5wYWdlPS0xO3RoaXMucGFnZXM9W107dGhpcy5uZXdQYWdlKCl9Qnl0ZUFycmF5LnBhZ2VTaXplPTQwOTY7Qnl0ZUFycmF5LmNoYXJNYXA9e307Zm9yKHZhciBpPTA7aTwyNTY7aSsrKUJ5dGVBcnJheS5jaGFyTWFwW2ldPVN0cmluZy5mcm9tQ2hhckNvZGUoaSk7Qnl0ZUFycmF5LnByb3RvdHlwZS5uZXdQYWdlPWZ1bmN0aW9uKCl7dGhpcy5wYWdlc1srK3RoaXMucGFnZV09bmV3IFVpbnQ4QXJyYXkoQnl0ZUFycmF5LnBhZ2VTaXplKTt0aGlzLmN1cnNvcj0wfTtCeXRlQXJyYXkucHJvdG90eXBlLmdldERhdGE9ZnVuY3Rpb24oKXt2YXIgcnY9XCJcIjtmb3IodmFyIHA9MDtwPHRoaXMucGFnZXMubGVuZ3RoO3ArKyl7Zm9yKHZhciBpPTA7aTxCeXRlQXJyYXkucGFnZVNpemU7aSsrKXtydis9Qnl0ZUFycmF5LmNoYXJNYXBbdGhpcy5wYWdlc1twXVtpXV19fXJldHVybiBydn07Qnl0ZUFycmF5LnByb3RvdHlwZS53cml0ZUJ5dGU9ZnVuY3Rpb24odmFsKXtpZih0aGlzLmN1cnNvcj49Qnl0ZUFycmF5LnBhZ2VTaXplKXRoaXMubmV3UGFnZSgpO3RoaXMucGFnZXNbdGhpcy5wYWdlXVt0aGlzLmN1cnNvcisrXT12YWx9O0J5dGVBcnJheS5wcm90b3R5cGUud3JpdGVVVEZCeXRlcz1mdW5jdGlvbihzdHJpbmcpe2Zvcih2YXIgbD1zdHJpbmcubGVuZ3RoLGk9MDtpPGw7aSsrKXRoaXMud3JpdGVCeXRlKHN0cmluZy5jaGFyQ29kZUF0KGkpKX07Qnl0ZUFycmF5LnByb3RvdHlwZS53cml0ZUJ5dGVzPWZ1bmN0aW9uKGFycmF5LG9mZnNldCxsZW5ndGgpe2Zvcih2YXIgbD1sZW5ndGh8fGFycmF5Lmxlbmd0aCxpPW9mZnNldHx8MDtpPGw7aSsrKXRoaXMud3JpdGVCeXRlKGFycmF5W2ldKX07ZnVuY3Rpb24gR0lGRW5jb2Rlcih3aWR0aCxoZWlnaHQpe3RoaXMud2lkdGg9fn53aWR0aDt0aGlzLmhlaWdodD1+fmhlaWdodDt0aGlzLnRyYW5zcGFyZW50PW51bGw7dGhpcy50cmFuc0luZGV4PTA7dGhpcy5yZXBlYXQ9LTE7dGhpcy5kZWxheT0wO3RoaXMuaW1hZ2U9bnVsbDt0aGlzLnBpeGVscz1udWxsO3RoaXMuaW5kZXhlZFBpeGVscz1udWxsO3RoaXMuY29sb3JEZXB0aD1udWxsO3RoaXMuY29sb3JUYWI9bnVsbDt0aGlzLm5ldVF1YW50PW51bGw7dGhpcy51c2VkRW50cnk9bmV3IEFycmF5O3RoaXMucGFsU2l6ZT03O3RoaXMuZGlzcG9zZT0tMTt0aGlzLmZpcnN0RnJhbWU9dHJ1ZTt0aGlzLnNhbXBsZT0xMDt0aGlzLmRpdGhlcj1mYWxzZTt0aGlzLmdsb2JhbFBhbGV0dGU9ZmFsc2U7dGhpcy5vdXQ9bmV3IEJ5dGVBcnJheX1HSUZFbmNvZGVyLnByb3RvdHlwZS5zZXREZWxheT1mdW5jdGlvbihtaWxsaXNlY29uZHMpe3RoaXMuZGVsYXk9TWF0aC5yb3VuZChtaWxsaXNlY29uZHMvMTApfTtHSUZFbmNvZGVyLnByb3RvdHlwZS5zZXRGcmFtZVJhdGU9ZnVuY3Rpb24oZnBzKXt0aGlzLmRlbGF5PU1hdGgucm91bmQoMTAwL2Zwcyl9O0dJRkVuY29kZXIucHJvdG90eXBlLnNldERpc3Bvc2U9ZnVuY3Rpb24oZGlzcG9zYWxDb2RlKXtpZihkaXNwb3NhbENvZGU+PTApdGhpcy5kaXNwb3NlPWRpc3Bvc2FsQ29kZX07R0lGRW5jb2Rlci5wcm90b3R5cGUuc2V0UmVwZWF0PWZ1bmN0aW9uKHJlcGVhdCl7dGhpcy5yZXBlYXQ9cmVwZWF0fTtHSUZFbmNvZGVyLnByb3RvdHlwZS5zZXRUcmFuc3BhcmVudD1mdW5jdGlvbihjb2xvcil7dGhpcy50cmFuc3BhcmVudD1jb2xvcn07R0lGRW5jb2Rlci5wcm90b3R5cGUuYWRkRnJhbWU9ZnVuY3Rpb24oaW1hZ2VEYXRhKXt0aGlzLmltYWdlPWltYWdlRGF0YTt0aGlzLmNvbG9yVGFiPXRoaXMuZ2xvYmFsUGFsZXR0ZSYmdGhpcy5nbG9iYWxQYWxldHRlLnNsaWNlP3RoaXMuZ2xvYmFsUGFsZXR0ZTpudWxsO3RoaXMuZ2V0SW1hZ2VQaXhlbHMoKTt0aGlzLmFuYWx5emVQaXhlbHMoKTtpZih0aGlzLmdsb2JhbFBhbGV0dGU9PT10cnVlKXRoaXMuZ2xvYmFsUGFsZXR0ZT10aGlzLmNvbG9yVGFiO2lmKHRoaXMuZmlyc3RGcmFtZSl7dGhpcy53cml0ZUxTRCgpO3RoaXMud3JpdGVQYWxldHRlKCk7aWYodGhpcy5yZXBlYXQ+PTApe3RoaXMud3JpdGVOZXRzY2FwZUV4dCgpfX10aGlzLndyaXRlR3JhcGhpY0N0cmxFeHQoKTt0aGlzLndyaXRlSW1hZ2VEZXNjKCk7aWYoIXRoaXMuZmlyc3RGcmFtZSYmIXRoaXMuZ2xvYmFsUGFsZXR0ZSl0aGlzLndyaXRlUGFsZXR0ZSgpO3RoaXMud3JpdGVQaXhlbHMoKTt0aGlzLmZpcnN0RnJhbWU9ZmFsc2V9O0dJRkVuY29kZXIucHJvdG90eXBlLmZpbmlzaD1mdW5jdGlvbigpe3RoaXMub3V0LndyaXRlQnl0ZSg1OSl9O0dJRkVuY29kZXIucHJvdG90eXBlLnNldFF1YWxpdHk9ZnVuY3Rpb24ocXVhbGl0eSl7aWYocXVhbGl0eTwxKXF1YWxpdHk9MTt0aGlzLnNhbXBsZT1xdWFsaXR5fTtHSUZFbmNvZGVyLnByb3RvdHlwZS5zZXREaXRoZXI9ZnVuY3Rpb24oZGl0aGVyKXtpZihkaXRoZXI9PT10cnVlKWRpdGhlcj1cIkZsb3lkU3RlaW5iZXJnXCI7dGhpcy5kaXRoZXI9ZGl0aGVyfTtHSUZFbmNvZGVyLnByb3RvdHlwZS5zZXRHbG9iYWxQYWxldHRlPWZ1bmN0aW9uKHBhbGV0dGUpe3RoaXMuZ2xvYmFsUGFsZXR0ZT1wYWxldHRlfTtHSUZFbmNvZGVyLnByb3RvdHlwZS5nZXRHbG9iYWxQYWxldHRlPWZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMuZ2xvYmFsUGFsZXR0ZSYmdGhpcy5nbG9iYWxQYWxldHRlLnNsaWNlJiZ0aGlzLmdsb2JhbFBhbGV0dGUuc2xpY2UoMCl8fHRoaXMuZ2xvYmFsUGFsZXR0ZX07R0lGRW5jb2Rlci5wcm90b3R5cGUud3JpdGVIZWFkZXI9ZnVuY3Rpb24oKXt0aGlzLm91dC53cml0ZVVURkJ5dGVzKFwiR0lGODlhXCIpfTtHSUZFbmNvZGVyLnByb3RvdHlwZS5hbmFseXplUGl4ZWxzPWZ1bmN0aW9uKCl7aWYoIXRoaXMuY29sb3JUYWIpe3RoaXMubmV1UXVhbnQ9bmV3IE5ldVF1YW50KHRoaXMucGl4ZWxzLHRoaXMuc2FtcGxlKTt0aGlzLm5ldVF1YW50LmJ1aWxkQ29sb3JtYXAoKTt0aGlzLmNvbG9yVGFiPXRoaXMubmV1UXVhbnQuZ2V0Q29sb3JtYXAoKX1pZih0aGlzLmRpdGhlcil7dGhpcy5kaXRoZXJQaXhlbHModGhpcy5kaXRoZXIucmVwbGFjZShcIi1zZXJwZW50aW5lXCIsXCJcIiksdGhpcy5kaXRoZXIubWF0Y2goLy1zZXJwZW50aW5lLykhPT1udWxsKX1lbHNle3RoaXMuaW5kZXhQaXhlbHMoKX10aGlzLnBpeGVscz1udWxsO3RoaXMuY29sb3JEZXB0aD04O3RoaXMucGFsU2l6ZT03O2lmKHRoaXMudHJhbnNwYXJlbnQhPT1udWxsKXt0aGlzLnRyYW5zSW5kZXg9dGhpcy5maW5kQ2xvc2VzdCh0aGlzLnRyYW5zcGFyZW50LHRydWUpfX07R0lGRW5jb2Rlci5wcm90b3R5cGUuaW5kZXhQaXhlbHM9ZnVuY3Rpb24oaW1ncSl7dmFyIG5QaXg9dGhpcy5waXhlbHMubGVuZ3RoLzM7dGhpcy5pbmRleGVkUGl4ZWxzPW5ldyBVaW50OEFycmF5KG5QaXgpO3ZhciBrPTA7Zm9yKHZhciBqPTA7ajxuUGl4O2orKyl7dmFyIGluZGV4PXRoaXMuZmluZENsb3Nlc3RSR0IodGhpcy5waXhlbHNbaysrXSYyNTUsdGhpcy5waXhlbHNbaysrXSYyNTUsdGhpcy5waXhlbHNbaysrXSYyNTUpO3RoaXMudXNlZEVudHJ5W2luZGV4XT10cnVlO3RoaXMuaW5kZXhlZFBpeGVsc1tqXT1pbmRleH19O0dJRkVuY29kZXIucHJvdG90eXBlLmRpdGhlclBpeGVscz1mdW5jdGlvbihrZXJuZWwsc2VycGVudGluZSl7dmFyIGtlcm5lbHM9e0ZhbHNlRmxveWRTdGVpbmJlcmc6W1szLzgsMSwwXSxbMy84LDAsMV0sWzIvOCwxLDFdXSxGbG95ZFN0ZWluYmVyZzpbWzcvMTYsMSwwXSxbMy8xNiwtMSwxXSxbNS8xNiwwLDFdLFsxLzE2LDEsMV1dLFN0dWNraTpbWzgvNDIsMSwwXSxbNC80MiwyLDBdLFsyLzQyLC0yLDFdLFs0LzQyLC0xLDFdLFs4LzQyLDAsMV0sWzQvNDIsMSwxXSxbMi80MiwyLDFdLFsxLzQyLC0yLDJdLFsyLzQyLC0xLDJdLFs0LzQyLDAsMl0sWzIvNDIsMSwyXSxbMS80MiwyLDJdXSxBdGtpbnNvbjpbWzEvOCwxLDBdLFsxLzgsMiwwXSxbMS84LC0xLDFdLFsxLzgsMCwxXSxbMS84LDEsMV0sWzEvOCwwLDJdXX07aWYoIWtlcm5lbHx8IWtlcm5lbHNba2VybmVsXSl7dGhyb3dcIlVua25vd24gZGl0aGVyaW5nIGtlcm5lbDogXCIra2VybmVsfXZhciBkcz1rZXJuZWxzW2tlcm5lbF07dmFyIGluZGV4PTAsaGVpZ2h0PXRoaXMuaGVpZ2h0LHdpZHRoPXRoaXMud2lkdGgsZGF0YT10aGlzLnBpeGVsczt2YXIgZGlyZWN0aW9uPXNlcnBlbnRpbmU/LTE6MTt0aGlzLmluZGV4ZWRQaXhlbHM9bmV3IFVpbnQ4QXJyYXkodGhpcy5waXhlbHMubGVuZ3RoLzMpO2Zvcih2YXIgeT0wO3k8aGVpZ2h0O3krKyl7aWYoc2VycGVudGluZSlkaXJlY3Rpb249ZGlyZWN0aW9uKi0xO2Zvcih2YXIgeD1kaXJlY3Rpb249PTE/MDp3aWR0aC0xLHhlbmQ9ZGlyZWN0aW9uPT0xP3dpZHRoOjA7eCE9PXhlbmQ7eCs9ZGlyZWN0aW9uKXtpbmRleD15KndpZHRoK3g7dmFyIGlkeD1pbmRleCozO3ZhciByMT1kYXRhW2lkeF07dmFyIGcxPWRhdGFbaWR4KzFdO3ZhciBiMT1kYXRhW2lkeCsyXTtpZHg9dGhpcy5maW5kQ2xvc2VzdFJHQihyMSxnMSxiMSk7dGhpcy51c2VkRW50cnlbaWR4XT10cnVlO3RoaXMuaW5kZXhlZFBpeGVsc1tpbmRleF09aWR4O2lkeCo9Mzt2YXIgcjI9dGhpcy5jb2xvclRhYltpZHhdO3ZhciBnMj10aGlzLmNvbG9yVGFiW2lkeCsxXTt2YXIgYjI9dGhpcy5jb2xvclRhYltpZHgrMl07dmFyIGVyPXIxLXIyO3ZhciBlZz1nMS1nMjt2YXIgZWI9YjEtYjI7Zm9yKHZhciBpPWRpcmVjdGlvbj09MT8wOmRzLmxlbmd0aC0xLGVuZD1kaXJlY3Rpb249PTE/ZHMubGVuZ3RoOjA7aSE9PWVuZDtpKz1kaXJlY3Rpb24pe3ZhciB4MT1kc1tpXVsxXTt2YXIgeTE9ZHNbaV1bMl07aWYoeDEreD49MCYmeDEreDx3aWR0aCYmeTEreT49MCYmeTEreTxoZWlnaHQpe3ZhciBkPWRzW2ldWzBdO2lkeD1pbmRleCt4MSt5MSp3aWR0aDtpZHgqPTM7ZGF0YVtpZHhdPU1hdGgubWF4KDAsTWF0aC5taW4oMjU1LGRhdGFbaWR4XStlcipkKSk7ZGF0YVtpZHgrMV09TWF0aC5tYXgoMCxNYXRoLm1pbigyNTUsZGF0YVtpZHgrMV0rZWcqZCkpO2RhdGFbaWR4KzJdPU1hdGgubWF4KDAsTWF0aC5taW4oMjU1LGRhdGFbaWR4KzJdK2ViKmQpKX19fX19O0dJRkVuY29kZXIucHJvdG90eXBlLmZpbmRDbG9zZXN0PWZ1bmN0aW9uKGMsdXNlZCl7cmV0dXJuIHRoaXMuZmluZENsb3Nlc3RSR0IoKGMmMTY3MTE2ODApPj4xNiwoYyY2NTI4MCk+PjgsYyYyNTUsdXNlZCl9O0dJRkVuY29kZXIucHJvdG90eXBlLmZpbmRDbG9zZXN0UkdCPWZ1bmN0aW9uKHIsZyxiLHVzZWQpe2lmKHRoaXMuY29sb3JUYWI9PT1udWxsKXJldHVybi0xO2lmKHRoaXMubmV1UXVhbnQmJiF1c2VkKXtyZXR1cm4gdGhpcy5uZXVRdWFudC5sb29rdXBSR0IocixnLGIpfXZhciBjPWJ8Zzw8OHxyPDwxNjt2YXIgbWlucG9zPTA7dmFyIGRtaW49MjU2KjI1NioyNTY7dmFyIGxlbj10aGlzLmNvbG9yVGFiLmxlbmd0aDtmb3IodmFyIGk9MCxpbmRleD0wO2k8bGVuO2luZGV4Kyspe3ZhciBkcj1yLSh0aGlzLmNvbG9yVGFiW2krK10mMjU1KTt2YXIgZGc9Zy0odGhpcy5jb2xvclRhYltpKytdJjI1NSk7dmFyIGRiPWItKHRoaXMuY29sb3JUYWJbaSsrXSYyNTUpO3ZhciBkPWRyKmRyK2RnKmRnK2RiKmRiO2lmKCghdXNlZHx8dGhpcy51c2VkRW50cnlbaW5kZXhdKSYmZDxkbWluKXtkbWluPWQ7bWlucG9zPWluZGV4fX1yZXR1cm4gbWlucG9zfTtHSUZFbmNvZGVyLnByb3RvdHlwZS5nZXRJbWFnZVBpeGVscz1mdW5jdGlvbigpe3ZhciB3PXRoaXMud2lkdGg7dmFyIGg9dGhpcy5oZWlnaHQ7dGhpcy5waXhlbHM9bmV3IFVpbnQ4QXJyYXkodypoKjMpO3ZhciBkYXRhPXRoaXMuaW1hZ2U7dmFyIHNyY1Bvcz0wO3ZhciBjb3VudD0wO2Zvcih2YXIgaT0wO2k8aDtpKyspe2Zvcih2YXIgaj0wO2o8dztqKyspe3RoaXMucGl4ZWxzW2NvdW50KytdPWRhdGFbc3JjUG9zKytdO3RoaXMucGl4ZWxzW2NvdW50KytdPWRhdGFbc3JjUG9zKytdO3RoaXMucGl4ZWxzW2NvdW50KytdPWRhdGFbc3JjUG9zKytdO3NyY1BvcysrfX19O0dJRkVuY29kZXIucHJvdG90eXBlLndyaXRlR3JhcGhpY0N0cmxFeHQ9ZnVuY3Rpb24oKXt0aGlzLm91dC53cml0ZUJ5dGUoMzMpO3RoaXMub3V0LndyaXRlQnl0ZSgyNDkpO3RoaXMub3V0LndyaXRlQnl0ZSg0KTt2YXIgdHJhbnNwLGRpc3A7aWYodGhpcy50cmFuc3BhcmVudD09PW51bGwpe3RyYW5zcD0wO2Rpc3A9MH1lbHNle3RyYW5zcD0xO2Rpc3A9Mn1pZih0aGlzLmRpc3Bvc2U+PTApe2Rpc3A9dGhpcy5kaXNwb3NlJjd9ZGlzcDw8PTI7dGhpcy5vdXQud3JpdGVCeXRlKDB8ZGlzcHwwfHRyYW5zcCk7dGhpcy53cml0ZVNob3J0KHRoaXMuZGVsYXkpO3RoaXMub3V0LndyaXRlQnl0ZSh0aGlzLnRyYW5zSW5kZXgpO3RoaXMub3V0LndyaXRlQnl0ZSgwKX07R0lGRW5jb2Rlci5wcm90b3R5cGUud3JpdGVJbWFnZURlc2M9ZnVuY3Rpb24oKXt0aGlzLm91dC53cml0ZUJ5dGUoNDQpO3RoaXMud3JpdGVTaG9ydCgwKTt0aGlzLndyaXRlU2hvcnQoMCk7dGhpcy53cml0ZVNob3J0KHRoaXMud2lkdGgpO3RoaXMud3JpdGVTaG9ydCh0aGlzLmhlaWdodCk7aWYodGhpcy5maXJzdEZyYW1lfHx0aGlzLmdsb2JhbFBhbGV0dGUpe3RoaXMub3V0LndyaXRlQnl0ZSgwKX1lbHNle3RoaXMub3V0LndyaXRlQnl0ZSgxMjh8MHwwfDB8dGhpcy5wYWxTaXplKX19O0dJRkVuY29kZXIucHJvdG90eXBlLndyaXRlTFNEPWZ1bmN0aW9uKCl7dGhpcy53cml0ZVNob3J0KHRoaXMud2lkdGgpO3RoaXMud3JpdGVTaG9ydCh0aGlzLmhlaWdodCk7dGhpcy5vdXQud3JpdGVCeXRlKDEyOHwxMTJ8MHx0aGlzLnBhbFNpemUpO3RoaXMub3V0LndyaXRlQnl0ZSgwKTt0aGlzLm91dC53cml0ZUJ5dGUoMCl9O0dJRkVuY29kZXIucHJvdG90eXBlLndyaXRlTmV0c2NhcGVFeHQ9ZnVuY3Rpb24oKXt0aGlzLm91dC53cml0ZUJ5dGUoMzMpO3RoaXMub3V0LndyaXRlQnl0ZSgyNTUpO3RoaXMub3V0LndyaXRlQnl0ZSgxMSk7dGhpcy5vdXQud3JpdGVVVEZCeXRlcyhcIk5FVFNDQVBFMi4wXCIpO3RoaXMub3V0LndyaXRlQnl0ZSgzKTt0aGlzLm91dC53cml0ZUJ5dGUoMSk7dGhpcy53cml0ZVNob3J0KHRoaXMucmVwZWF0KTt0aGlzLm91dC53cml0ZUJ5dGUoMCl9O0dJRkVuY29kZXIucHJvdG90eXBlLndyaXRlUGFsZXR0ZT1mdW5jdGlvbigpe3RoaXMub3V0LndyaXRlQnl0ZXModGhpcy5jb2xvclRhYik7dmFyIG49MyoyNTYtdGhpcy5jb2xvclRhYi5sZW5ndGg7Zm9yKHZhciBpPTA7aTxuO2krKyl0aGlzLm91dC53cml0ZUJ5dGUoMCl9O0dJRkVuY29kZXIucHJvdG90eXBlLndyaXRlU2hvcnQ9ZnVuY3Rpb24ocFZhbHVlKXt0aGlzLm91dC53cml0ZUJ5dGUocFZhbHVlJjI1NSk7dGhpcy5vdXQud3JpdGVCeXRlKHBWYWx1ZT4+OCYyNTUpfTtHSUZFbmNvZGVyLnByb3RvdHlwZS53cml0ZVBpeGVscz1mdW5jdGlvbigpe3ZhciBlbmM9bmV3IExaV0VuY29kZXIodGhpcy53aWR0aCx0aGlzLmhlaWdodCx0aGlzLmluZGV4ZWRQaXhlbHMsdGhpcy5jb2xvckRlcHRoKTtlbmMuZW5jb2RlKHRoaXMub3V0KX07R0lGRW5jb2Rlci5wcm90b3R5cGUuc3RyZWFtPWZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMub3V0fTttb2R1bGUuZXhwb3J0cz1HSUZFbmNvZGVyfSx7XCIuL0xaV0VuY29kZXIuanNcIjozLFwiLi9UeXBlZE5ldVF1YW50LmpzXCI6NH1dLDM6W2Z1bmN0aW9uKHJlcXVpcmUsbW9kdWxlLGV4cG9ydHMpe3ZhciBFT0Y9LTE7dmFyIEJJVFM9MTI7dmFyIEhTSVpFPTUwMDM7dmFyIG1hc2tzPVswLDEsMyw3LDE1LDMxLDYzLDEyNywyNTUsNTExLDEwMjMsMjA0Nyw0MDk1LDgxOTEsMTYzODMsMzI3NjcsNjU1MzVdO2Z1bmN0aW9uIExaV0VuY29kZXIod2lkdGgsaGVpZ2h0LHBpeGVscyxjb2xvckRlcHRoKXt2YXIgaW5pdENvZGVTaXplPU1hdGgubWF4KDIsY29sb3JEZXB0aCk7dmFyIGFjY3VtPW5ldyBVaW50OEFycmF5KDI1Nik7dmFyIGh0YWI9bmV3IEludDMyQXJyYXkoSFNJWkUpO3ZhciBjb2RldGFiPW5ldyBJbnQzMkFycmF5KEhTSVpFKTt2YXIgY3VyX2FjY3VtLGN1cl9iaXRzPTA7dmFyIGFfY291bnQ7dmFyIGZyZWVfZW50PTA7dmFyIG1heGNvZGU7dmFyIGNsZWFyX2ZsZz1mYWxzZTt2YXIgZ19pbml0X2JpdHMsQ2xlYXJDb2RlLEVPRkNvZGU7ZnVuY3Rpb24gY2hhcl9vdXQoYyxvdXRzKXthY2N1bVthX2NvdW50KytdPWM7aWYoYV9jb3VudD49MjU0KWZsdXNoX2NoYXIob3V0cyl9ZnVuY3Rpb24gY2xfYmxvY2sob3V0cyl7Y2xfaGFzaChIU0laRSk7ZnJlZV9lbnQ9Q2xlYXJDb2RlKzI7Y2xlYXJfZmxnPXRydWU7b3V0cHV0KENsZWFyQ29kZSxvdXRzKX1mdW5jdGlvbiBjbF9oYXNoKGhzaXplKXtmb3IodmFyIGk9MDtpPGhzaXplOysraSlodGFiW2ldPS0xfWZ1bmN0aW9uIGNvbXByZXNzKGluaXRfYml0cyxvdXRzKXt2YXIgZmNvZGUsYyxpLGVudCxkaXNwLGhzaXplX3JlZyxoc2hpZnQ7Z19pbml0X2JpdHM9aW5pdF9iaXRzO2NsZWFyX2ZsZz1mYWxzZTtuX2JpdHM9Z19pbml0X2JpdHM7bWF4Y29kZT1NQVhDT0RFKG5fYml0cyk7Q2xlYXJDb2RlPTE8PGluaXRfYml0cy0xO0VPRkNvZGU9Q2xlYXJDb2RlKzE7ZnJlZV9lbnQ9Q2xlYXJDb2RlKzI7YV9jb3VudD0wO2VudD1uZXh0UGl4ZWwoKTtoc2hpZnQ9MDtmb3IoZmNvZGU9SFNJWkU7ZmNvZGU8NjU1MzY7ZmNvZGUqPTIpKytoc2hpZnQ7aHNoaWZ0PTgtaHNoaWZ0O2hzaXplX3JlZz1IU0laRTtjbF9oYXNoKGhzaXplX3JlZyk7b3V0cHV0KENsZWFyQ29kZSxvdXRzKTtvdXRlcl9sb29wOndoaWxlKChjPW5leHRQaXhlbCgpKSE9RU9GKXtmY29kZT0oYzw8QklUUykrZW50O2k9Yzw8aHNoaWZ0XmVudDtpZihodGFiW2ldPT09ZmNvZGUpe2VudD1jb2RldGFiW2ldO2NvbnRpbnVlfWVsc2UgaWYoaHRhYltpXT49MCl7ZGlzcD1oc2l6ZV9yZWctaTtpZihpPT09MClkaXNwPTE7ZG97aWYoKGktPWRpc3ApPDApaSs9aHNpemVfcmVnO2lmKGh0YWJbaV09PT1mY29kZSl7ZW50PWNvZGV0YWJbaV07Y29udGludWUgb3V0ZXJfbG9vcH19d2hpbGUoaHRhYltpXT49MCl9b3V0cHV0KGVudCxvdXRzKTtlbnQ9YztpZihmcmVlX2VudDwxPDxCSVRTKXtjb2RldGFiW2ldPWZyZWVfZW50Kys7aHRhYltpXT1mY29kZX1lbHNle2NsX2Jsb2NrKG91dHMpfX1vdXRwdXQoZW50LG91dHMpO291dHB1dChFT0ZDb2RlLG91dHMpfWZ1bmN0aW9uIGVuY29kZShvdXRzKXtvdXRzLndyaXRlQnl0ZShpbml0Q29kZVNpemUpO3JlbWFpbmluZz13aWR0aCpoZWlnaHQ7Y3VyUGl4ZWw9MDtjb21wcmVzcyhpbml0Q29kZVNpemUrMSxvdXRzKTtvdXRzLndyaXRlQnl0ZSgwKX1mdW5jdGlvbiBmbHVzaF9jaGFyKG91dHMpe2lmKGFfY291bnQ+MCl7b3V0cy53cml0ZUJ5dGUoYV9jb3VudCk7b3V0cy53cml0ZUJ5dGVzKGFjY3VtLDAsYV9jb3VudCk7YV9jb3VudD0wfX1mdW5jdGlvbiBNQVhDT0RFKG5fYml0cyl7cmV0dXJuKDE8PG5fYml0cyktMX1mdW5jdGlvbiBuZXh0UGl4ZWwoKXtpZihyZW1haW5pbmc9PT0wKXJldHVybiBFT0Y7LS1yZW1haW5pbmc7dmFyIHBpeD1waXhlbHNbY3VyUGl4ZWwrK107cmV0dXJuIHBpeCYyNTV9ZnVuY3Rpb24gb3V0cHV0KGNvZGUsb3V0cyl7Y3VyX2FjY3VtJj1tYXNrc1tjdXJfYml0c107aWYoY3VyX2JpdHM+MCljdXJfYWNjdW18PWNvZGU8PGN1cl9iaXRzO2Vsc2UgY3VyX2FjY3VtPWNvZGU7Y3VyX2JpdHMrPW5fYml0czt3aGlsZShjdXJfYml0cz49OCl7Y2hhcl9vdXQoY3VyX2FjY3VtJjI1NSxvdXRzKTtjdXJfYWNjdW0+Pj04O2N1cl9iaXRzLT04fWlmKGZyZWVfZW50Pm1heGNvZGV8fGNsZWFyX2ZsZyl7aWYoY2xlYXJfZmxnKXttYXhjb2RlPU1BWENPREUobl9iaXRzPWdfaW5pdF9iaXRzKTtjbGVhcl9mbGc9ZmFsc2V9ZWxzZXsrK25fYml0cztpZihuX2JpdHM9PUJJVFMpbWF4Y29kZT0xPDxCSVRTO2Vsc2UgbWF4Y29kZT1NQVhDT0RFKG5fYml0cyl9fWlmKGNvZGU9PUVPRkNvZGUpe3doaWxlKGN1cl9iaXRzPjApe2NoYXJfb3V0KGN1cl9hY2N1bSYyNTUsb3V0cyk7Y3VyX2FjY3VtPj49ODtjdXJfYml0cy09OH1mbHVzaF9jaGFyKG91dHMpfX10aGlzLmVuY29kZT1lbmNvZGV9bW9kdWxlLmV4cG9ydHM9TFpXRW5jb2Rlcn0se31dLDQ6W2Z1bmN0aW9uKHJlcXVpcmUsbW9kdWxlLGV4cG9ydHMpe3ZhciBuY3ljbGVzPTEwMDt2YXIgbmV0c2l6ZT0yNTY7dmFyIG1heG5ldHBvcz1uZXRzaXplLTE7dmFyIG5ldGJpYXNzaGlmdD00O3ZhciBpbnRiaWFzc2hpZnQ9MTY7dmFyIGludGJpYXM9MTw8aW50Ymlhc3NoaWZ0O3ZhciBnYW1tYXNoaWZ0PTEwO3ZhciBnYW1tYT0xPDxnYW1tYXNoaWZ0O3ZhciBiZXRhc2hpZnQ9MTA7dmFyIGJldGE9aW50Ymlhcz4+YmV0YXNoaWZ0O3ZhciBiZXRhZ2FtbWE9aW50Ymlhczw8Z2FtbWFzaGlmdC1iZXRhc2hpZnQ7dmFyIGluaXRyYWQ9bmV0c2l6ZT4+Mzt2YXIgcmFkaXVzYmlhc3NoaWZ0PTY7dmFyIHJhZGl1c2JpYXM9MTw8cmFkaXVzYmlhc3NoaWZ0O3ZhciBpbml0cmFkaXVzPWluaXRyYWQqcmFkaXVzYmlhczt2YXIgcmFkaXVzZGVjPTMwO3ZhciBhbHBoYWJpYXNzaGlmdD0xMDt2YXIgaW5pdGFscGhhPTE8PGFscGhhYmlhc3NoaWZ0O3ZhciBhbHBoYWRlYzt2YXIgcmFkYmlhc3NoaWZ0PTg7dmFyIHJhZGJpYXM9MTw8cmFkYmlhc3NoaWZ0O3ZhciBhbHBoYXJhZGJzaGlmdD1hbHBoYWJpYXNzaGlmdCtyYWRiaWFzc2hpZnQ7dmFyIGFscGhhcmFkYmlhcz0xPDxhbHBoYXJhZGJzaGlmdDt2YXIgcHJpbWUxPTQ5OTt2YXIgcHJpbWUyPTQ5MTt2YXIgcHJpbWUzPTQ4Nzt2YXIgcHJpbWU0PTUwMzt2YXIgbWlucGljdHVyZWJ5dGVzPTMqcHJpbWU0O2Z1bmN0aW9uIE5ldVF1YW50KHBpeGVscyxzYW1wbGVmYWMpe3ZhciBuZXR3b3JrO3ZhciBuZXRpbmRleDt2YXIgYmlhczt2YXIgZnJlcTt2YXIgcmFkcG93ZXI7ZnVuY3Rpb24gaW5pdCgpe25ldHdvcms9W107bmV0aW5kZXg9bmV3IEludDMyQXJyYXkoMjU2KTtiaWFzPW5ldyBJbnQzMkFycmF5KG5ldHNpemUpO2ZyZXE9bmV3IEludDMyQXJyYXkobmV0c2l6ZSk7cmFkcG93ZXI9bmV3IEludDMyQXJyYXkobmV0c2l6ZT4+Myk7dmFyIGksdjtmb3IoaT0wO2k8bmV0c2l6ZTtpKyspe3Y9KGk8PG5ldGJpYXNzaGlmdCs4KS9uZXRzaXplO25ldHdvcmtbaV09bmV3IEZsb2F0NjRBcnJheShbdix2LHYsMF0pO2ZyZXFbaV09aW50Ymlhcy9uZXRzaXplO2JpYXNbaV09MH19ZnVuY3Rpb24gdW5iaWFzbmV0KCl7Zm9yKHZhciBpPTA7aTxuZXRzaXplO2krKyl7bmV0d29ya1tpXVswXT4+PW5ldGJpYXNzaGlmdDtuZXR3b3JrW2ldWzFdPj49bmV0Ymlhc3NoaWZ0O25ldHdvcmtbaV1bMl0+Pj1uZXRiaWFzc2hpZnQ7bmV0d29ya1tpXVszXT1pfX1mdW5jdGlvbiBhbHRlcnNpbmdsZShhbHBoYSxpLGIsZyxyKXtuZXR3b3JrW2ldWzBdLT1hbHBoYSoobmV0d29ya1tpXVswXS1iKS9pbml0YWxwaGE7bmV0d29ya1tpXVsxXS09YWxwaGEqKG5ldHdvcmtbaV1bMV0tZykvaW5pdGFscGhhO25ldHdvcmtbaV1bMl0tPWFscGhhKihuZXR3b3JrW2ldWzJdLXIpL2luaXRhbHBoYX1mdW5jdGlvbiBhbHRlcm5laWdoKHJhZGl1cyxpLGIsZyxyKXt2YXIgbG89TWF0aC5hYnMoaS1yYWRpdXMpO3ZhciBoaT1NYXRoLm1pbihpK3JhZGl1cyxuZXRzaXplKTt2YXIgaj1pKzE7dmFyIGs9aS0xO3ZhciBtPTE7dmFyIHAsYTt3aGlsZShqPGhpfHxrPmxvKXthPXJhZHBvd2VyW20rK107aWYoajxoaSl7cD1uZXR3b3JrW2orK107cFswXS09YSoocFswXS1iKS9hbHBoYXJhZGJpYXM7cFsxXS09YSoocFsxXS1nKS9hbHBoYXJhZGJpYXM7cFsyXS09YSoocFsyXS1yKS9hbHBoYXJhZGJpYXN9aWYoaz5sbyl7cD1uZXR3b3JrW2stLV07cFswXS09YSoocFswXS1iKS9hbHBoYXJhZGJpYXM7cFsxXS09YSoocFsxXS1nKS9hbHBoYXJhZGJpYXM7cFsyXS09YSoocFsyXS1yKS9hbHBoYXJhZGJpYXN9fX1mdW5jdGlvbiBjb250ZXN0KGIsZyxyKXt2YXIgYmVzdGQ9figxPDwzMSk7dmFyIGJlc3RiaWFzZD1iZXN0ZDt2YXIgYmVzdHBvcz0tMTt2YXIgYmVzdGJpYXNwb3M9YmVzdHBvczt2YXIgaSxuLGRpc3QsYmlhc2Rpc3QsYmV0YWZyZXE7Zm9yKGk9MDtpPG5ldHNpemU7aSsrKXtuPW5ldHdvcmtbaV07ZGlzdD1NYXRoLmFicyhuWzBdLWIpK01hdGguYWJzKG5bMV0tZykrTWF0aC5hYnMoblsyXS1yKTtpZihkaXN0PGJlc3RkKXtiZXN0ZD1kaXN0O2Jlc3Rwb3M9aX1iaWFzZGlzdD1kaXN0LShiaWFzW2ldPj5pbnRiaWFzc2hpZnQtbmV0Ymlhc3NoaWZ0KTtpZihiaWFzZGlzdDxiZXN0Ymlhc2Qpe2Jlc3RiaWFzZD1iaWFzZGlzdDtiZXN0Ymlhc3Bvcz1pfWJldGFmcmVxPWZyZXFbaV0+PmJldGFzaGlmdDtmcmVxW2ldLT1iZXRhZnJlcTtiaWFzW2ldKz1iZXRhZnJlcTw8Z2FtbWFzaGlmdH1mcmVxW2Jlc3Rwb3NdKz1iZXRhO2JpYXNbYmVzdHBvc10tPWJldGFnYW1tYTtyZXR1cm4gYmVzdGJpYXNwb3N9ZnVuY3Rpb24gaW54YnVpbGQoKXt2YXIgaSxqLHAscSxzbWFsbHBvcyxzbWFsbHZhbCxwcmV2aW91c2NvbD0wLHN0YXJ0cG9zPTA7Zm9yKGk9MDtpPG5ldHNpemU7aSsrKXtwPW5ldHdvcmtbaV07c21hbGxwb3M9aTtzbWFsbHZhbD1wWzFdO2ZvcihqPWkrMTtqPG5ldHNpemU7aisrKXtxPW5ldHdvcmtbal07aWYocVsxXTxzbWFsbHZhbCl7c21hbGxwb3M9ajtzbWFsbHZhbD1xWzFdfX1xPW5ldHdvcmtbc21hbGxwb3NdO2lmKGkhPXNtYWxscG9zKXtqPXFbMF07cVswXT1wWzBdO3BbMF09ajtqPXFbMV07cVsxXT1wWzFdO3BbMV09ajtqPXFbMl07cVsyXT1wWzJdO3BbMl09ajtqPXFbM107cVszXT1wWzNdO3BbM109an1pZihzbWFsbHZhbCE9cHJldmlvdXNjb2wpe25ldGluZGV4W3ByZXZpb3VzY29sXT1zdGFydHBvcytpPj4xO2ZvcihqPXByZXZpb3VzY29sKzE7ajxzbWFsbHZhbDtqKyspbmV0aW5kZXhbal09aTtwcmV2aW91c2NvbD1zbWFsbHZhbDtzdGFydHBvcz1pfX1uZXRpbmRleFtwcmV2aW91c2NvbF09c3RhcnRwb3MrbWF4bmV0cG9zPj4xO2ZvcihqPXByZXZpb3VzY29sKzE7ajwyNTY7aisrKW5ldGluZGV4W2pdPW1heG5ldHBvc31mdW5jdGlvbiBpbnhzZWFyY2goYixnLHIpe3ZhciBhLHAsZGlzdDt2YXIgYmVzdGQ9MWUzO3ZhciBiZXN0PS0xO3ZhciBpPW5ldGluZGV4W2ddO3ZhciBqPWktMTt3aGlsZShpPG5ldHNpemV8fGo+PTApe2lmKGk8bmV0c2l6ZSl7cD1uZXR3b3JrW2ldO2Rpc3Q9cFsxXS1nO2lmKGRpc3Q+PWJlc3RkKWk9bmV0c2l6ZTtlbHNle2krKztpZihkaXN0PDApZGlzdD0tZGlzdDthPXBbMF0tYjtpZihhPDApYT0tYTtkaXN0Kz1hO2lmKGRpc3Q8YmVzdGQpe2E9cFsyXS1yO2lmKGE8MClhPS1hO2Rpc3QrPWE7aWYoZGlzdDxiZXN0ZCl7YmVzdGQ9ZGlzdDtiZXN0PXBbM119fX19aWYoaj49MCl7cD1uZXR3b3JrW2pdO2Rpc3Q9Zy1wWzFdO2lmKGRpc3Q+PWJlc3RkKWo9LTE7ZWxzZXtqLS07aWYoZGlzdDwwKWRpc3Q9LWRpc3Q7YT1wWzBdLWI7aWYoYTwwKWE9LWE7ZGlzdCs9YTtpZihkaXN0PGJlc3RkKXthPXBbMl0tcjtpZihhPDApYT0tYTtkaXN0Kz1hO2lmKGRpc3Q8YmVzdGQpe2Jlc3RkPWRpc3Q7YmVzdD1wWzNdfX19fX1yZXR1cm4gYmVzdH1mdW5jdGlvbiBsZWFybigpe3ZhciBpO3ZhciBsZW5ndGhjb3VudD1waXhlbHMubGVuZ3RoO3ZhciBhbHBoYWRlYz0zMCsoc2FtcGxlZmFjLTEpLzM7dmFyIHNhbXBsZXBpeGVscz1sZW5ndGhjb3VudC8oMypzYW1wbGVmYWMpO3ZhciBkZWx0YT1+fihzYW1wbGVwaXhlbHMvbmN5Y2xlcyk7dmFyIGFscGhhPWluaXRhbHBoYTt2YXIgcmFkaXVzPWluaXRyYWRpdXM7dmFyIHJhZD1yYWRpdXM+PnJhZGl1c2JpYXNzaGlmdDtpZihyYWQ8PTEpcmFkPTA7Zm9yKGk9MDtpPHJhZDtpKyspcmFkcG93ZXJbaV09YWxwaGEqKChyYWQqcmFkLWkqaSkqcmFkYmlhcy8ocmFkKnJhZCkpO3ZhciBzdGVwO2lmKGxlbmd0aGNvdW50PG1pbnBpY3R1cmVieXRlcyl7c2FtcGxlZmFjPTE7c3RlcD0zfWVsc2UgaWYobGVuZ3RoY291bnQlcHJpbWUxIT09MCl7c3RlcD0zKnByaW1lMX1lbHNlIGlmKGxlbmd0aGNvdW50JXByaW1lMiE9PTApe3N0ZXA9MypwcmltZTJ9ZWxzZSBpZihsZW5ndGhjb3VudCVwcmltZTMhPT0wKXtzdGVwPTMqcHJpbWUzfWVsc2V7c3RlcD0zKnByaW1lNH12YXIgYixnLHIsajt2YXIgcGl4PTA7aT0wO3doaWxlKGk8c2FtcGxlcGl4ZWxzKXtiPShwaXhlbHNbcGl4XSYyNTUpPDxuZXRiaWFzc2hpZnQ7Zz0ocGl4ZWxzW3BpeCsxXSYyNTUpPDxuZXRiaWFzc2hpZnQ7cj0ocGl4ZWxzW3BpeCsyXSYyNTUpPDxuZXRiaWFzc2hpZnQ7aj1jb250ZXN0KGIsZyxyKTthbHRlcnNpbmdsZShhbHBoYSxqLGIsZyxyKTtpZihyYWQhPT0wKWFsdGVybmVpZ2gocmFkLGosYixnLHIpO3BpeCs9c3RlcDtpZihwaXg+PWxlbmd0aGNvdW50KXBpeC09bGVuZ3RoY291bnQ7aSsrO2lmKGRlbHRhPT09MClkZWx0YT0xO2lmKGklZGVsdGE9PT0wKXthbHBoYS09YWxwaGEvYWxwaGFkZWM7cmFkaXVzLT1yYWRpdXMvcmFkaXVzZGVjO3JhZD1yYWRpdXM+PnJhZGl1c2JpYXNzaGlmdDtpZihyYWQ8PTEpcmFkPTA7Zm9yKGo9MDtqPHJhZDtqKyspcmFkcG93ZXJbal09YWxwaGEqKChyYWQqcmFkLWoqaikqcmFkYmlhcy8ocmFkKnJhZCkpfX19ZnVuY3Rpb24gYnVpbGRDb2xvcm1hcCgpe2luaXQoKTtsZWFybigpO3VuYmlhc25ldCgpO2lueGJ1aWxkKCl9dGhpcy5idWlsZENvbG9ybWFwPWJ1aWxkQ29sb3JtYXA7ZnVuY3Rpb24gZ2V0Q29sb3JtYXAoKXt2YXIgbWFwPVtdO3ZhciBpbmRleD1bXTtmb3IodmFyIGk9MDtpPG5ldHNpemU7aSsrKWluZGV4W25ldHdvcmtbaV1bM11dPWk7dmFyIGs9MDtmb3IodmFyIGw9MDtsPG5ldHNpemU7bCsrKXt2YXIgaj1pbmRleFtsXTttYXBbaysrXT1uZXR3b3JrW2pdWzBdO21hcFtrKytdPW5ldHdvcmtbal1bMV07bWFwW2srK109bmV0d29ya1tqXVsyXX1yZXR1cm4gbWFwfXRoaXMuZ2V0Q29sb3JtYXA9Z2V0Q29sb3JtYXA7dGhpcy5sb29rdXBSR0I9aW54c2VhcmNofW1vZHVsZS5leHBvcnRzPU5ldVF1YW50fSx7fV0sNTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7dmFyIFVBLGJyb3dzZXIsbW9kZSxwbGF0Zm9ybSx1YTt1YT1uYXZpZ2F0b3IudXNlckFnZW50LnRvTG93ZXJDYXNlKCk7cGxhdGZvcm09bmF2aWdhdG9yLnBsYXRmb3JtLnRvTG93ZXJDYXNlKCk7VUE9dWEubWF0Y2goLyhvcGVyYXxpZXxmaXJlZm94fGNocm9tZXx2ZXJzaW9uKVtcXHNcXC86XShbXFx3XFxkXFwuXSspPy4qPyhzYWZhcml8dmVyc2lvbltcXHNcXC86XShbXFx3XFxkXFwuXSspfCQpLyl8fFtudWxsLFwidW5rbm93blwiLDBdO21vZGU9VUFbMV09PT1cImllXCImJmRvY3VtZW50LmRvY3VtZW50TW9kZTticm93c2VyPXtuYW1lOlVBWzFdPT09XCJ2ZXJzaW9uXCI/VUFbM106VUFbMV0sdmVyc2lvbjptb2RlfHxwYXJzZUZsb2F0KFVBWzFdPT09XCJvcGVyYVwiJiZVQVs0XT9VQVs0XTpVQVsyXSkscGxhdGZvcm06e25hbWU6dWEubWF0Y2goL2lwKD86YWR8b2R8aG9uZSkvKT9cImlvc1wiOih1YS5tYXRjaCgvKD86d2Vib3N8YW5kcm9pZCkvKXx8cGxhdGZvcm0ubWF0Y2goL21hY3x3aW58bGludXgvKXx8W1wib3RoZXJcIl0pWzBdfX07YnJvd3Nlclticm93c2VyLm5hbWVdPXRydWU7YnJvd3Nlclticm93c2VyLm5hbWUrcGFyc2VJbnQoYnJvd3Nlci52ZXJzaW9uLDEwKV09dHJ1ZTticm93c2VyLnBsYXRmb3JtW2Jyb3dzZXIucGxhdGZvcm0ubmFtZV09dHJ1ZTttb2R1bGUuZXhwb3J0cz1icm93c2VyfSx7fV0sNjpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7dmFyIEV2ZW50RW1pdHRlcixHSUYsR0lGRW5jb2Rlcixicm93c2VyLGdpZldvcmtlcixleHRlbmQ9ZnVuY3Rpb24oY2hpbGQscGFyZW50KXtmb3IodmFyIGtleSBpbiBwYXJlbnQpe2lmKGhhc1Byb3AuY2FsbChwYXJlbnQsa2V5KSljaGlsZFtrZXldPXBhcmVudFtrZXldfWZ1bmN0aW9uIGN0b3IoKXt0aGlzLmNvbnN0cnVjdG9yPWNoaWxkfWN0b3IucHJvdG90eXBlPXBhcmVudC5wcm90b3R5cGU7Y2hpbGQucHJvdG90eXBlPW5ldyBjdG9yO2NoaWxkLl9fc3VwZXJfXz1wYXJlbnQucHJvdG90eXBlO3JldHVybiBjaGlsZH0saGFzUHJvcD17fS5oYXNPd25Qcm9wZXJ0eSxpbmRleE9mPVtdLmluZGV4T2Z8fGZ1bmN0aW9uKGl0ZW0pe2Zvcih2YXIgaT0wLGw9dGhpcy5sZW5ndGg7aTxsO2krKyl7aWYoaSBpbiB0aGlzJiZ0aGlzW2ldPT09aXRlbSlyZXR1cm4gaX1yZXR1cm4tMX0sc2xpY2U9W10uc2xpY2U7RXZlbnRFbWl0dGVyPXJlcXVpcmUoXCJldmVudHNcIikuRXZlbnRFbWl0dGVyO2Jyb3dzZXI9cmVxdWlyZShcIi4vYnJvd3Nlci5jb2ZmZWVcIik7R0lGRW5jb2Rlcj1yZXF1aXJlKFwiLi9HSUZFbmNvZGVyLmpzXCIpO2dpZldvcmtlcj1yZXF1aXJlKFwiLi9naWYud29ya2VyLmNvZmZlZVwiKTttb2R1bGUuZXhwb3J0cz1HSUY9ZnVuY3Rpb24oc3VwZXJDbGFzcyl7dmFyIGRlZmF1bHRzLGZyYW1lRGVmYXVsdHM7ZXh0ZW5kKEdJRixzdXBlckNsYXNzKTtkZWZhdWx0cz17d29ya2VyU2NyaXB0OlwiZ2lmLndvcmtlci5qc1wiLHdvcmtlcnM6MixyZXBlYXQ6MCxiYWNrZ3JvdW5kOlwiI2ZmZlwiLHF1YWxpdHk6MTAsd2lkdGg6bnVsbCxoZWlnaHQ6bnVsbCx0cmFuc3BhcmVudDpudWxsLGRlYnVnOmZhbHNlLGRpdGhlcjpmYWxzZX07ZnJhbWVEZWZhdWx0cz17ZGVsYXk6NTAwLGNvcHk6ZmFsc2UsZGlzcG9zZTotMX07ZnVuY3Rpb24gR0lGKG9wdGlvbnMpe3ZhciBiYXNlLGtleSx2YWx1ZTt0aGlzLnJ1bm5pbmc9ZmFsc2U7dGhpcy5vcHRpb25zPXt9O3RoaXMuZnJhbWVzPVtdO3RoaXMuZnJlZVdvcmtlcnM9W107dGhpcy5hY3RpdmVXb3JrZXJzPVtdO3RoaXMuc2V0T3B0aW9ucyhvcHRpb25zKTtmb3Ioa2V5IGluIGRlZmF1bHRzKXt2YWx1ZT1kZWZhdWx0c1trZXldO2lmKChiYXNlPXRoaXMub3B0aW9ucylba2V5XT09bnVsbCl7YmFzZVtrZXldPXZhbHVlfX19R0lGLnByb3RvdHlwZS5zZXRPcHRpb249ZnVuY3Rpb24oa2V5LHZhbHVlKXt0aGlzLm9wdGlvbnNba2V5XT12YWx1ZTtpZih0aGlzLl9jYW52YXMhPW51bGwmJihrZXk9PT1cIndpZHRoXCJ8fGtleT09PVwiaGVpZ2h0XCIpKXtyZXR1cm4gdGhpcy5fY2FudmFzW2tleV09dmFsdWV9fTtHSUYucHJvdG90eXBlLnNldE9wdGlvbnM9ZnVuY3Rpb24ob3B0aW9ucyl7dmFyIGtleSxyZXN1bHRzLHZhbHVlO3Jlc3VsdHM9W107Zm9yKGtleSBpbiBvcHRpb25zKXtpZighaGFzUHJvcC5jYWxsKG9wdGlvbnMsa2V5KSljb250aW51ZTt2YWx1ZT1vcHRpb25zW2tleV07cmVzdWx0cy5wdXNoKHRoaXMuc2V0T3B0aW9uKGtleSx2YWx1ZSkpfXJldHVybiByZXN1bHRzfTtHSUYucHJvdG90eXBlLmFkZEZyYW1lPWZ1bmN0aW9uKGltYWdlLG9wdGlvbnMpe3ZhciBmcmFtZSxrZXk7aWYob3B0aW9ucz09bnVsbCl7b3B0aW9ucz17fX1mcmFtZT17fTtmcmFtZS50cmFuc3BhcmVudD10aGlzLm9wdGlvbnMudHJhbnNwYXJlbnQ7Zm9yKGtleSBpbiBmcmFtZURlZmF1bHRzKXtmcmFtZVtrZXldPW9wdGlvbnNba2V5XXx8ZnJhbWVEZWZhdWx0c1trZXldfWlmKHRoaXMub3B0aW9ucy53aWR0aD09bnVsbCl7dGhpcy5zZXRPcHRpb24oXCJ3aWR0aFwiLGltYWdlLndpZHRoKX1pZih0aGlzLm9wdGlvbnMuaGVpZ2h0PT1udWxsKXt0aGlzLnNldE9wdGlvbihcImhlaWdodFwiLGltYWdlLmhlaWdodCl9aWYodHlwZW9mIEltYWdlRGF0YSE9PVwidW5kZWZpbmVkXCImJkltYWdlRGF0YSE9PW51bGwmJmltYWdlIGluc3RhbmNlb2YgSW1hZ2VEYXRhKXtmcmFtZS5kYXRhPWltYWdlLmRhdGF9ZWxzZSBpZih0eXBlb2YgQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEIT09XCJ1bmRlZmluZWRcIiYmQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEIT09bnVsbCYmaW1hZ2UgaW5zdGFuY2VvZiBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkR8fHR5cGVvZiBXZWJHTFJlbmRlcmluZ0NvbnRleHQhPT1cInVuZGVmaW5lZFwiJiZXZWJHTFJlbmRlcmluZ0NvbnRleHQhPT1udWxsJiZpbWFnZSBpbnN0YW5jZW9mIFdlYkdMUmVuZGVyaW5nQ29udGV4dCl7aWYob3B0aW9ucy5jb3B5KXtmcmFtZS5kYXRhPXRoaXMuZ2V0Q29udGV4dERhdGEoaW1hZ2UpfWVsc2V7ZnJhbWUuY29udGV4dD1pbWFnZX19ZWxzZSBpZihpbWFnZS5jaGlsZE5vZGVzIT1udWxsKXtpZihvcHRpb25zLmNvcHkpe2ZyYW1lLmRhdGE9dGhpcy5nZXRJbWFnZURhdGEoaW1hZ2UpfWVsc2V7ZnJhbWUuaW1hZ2U9aW1hZ2V9fWVsc2V7dGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBpbWFnZVwiKX1yZXR1cm4gdGhpcy5mcmFtZXMucHVzaChmcmFtZSl9O0dJRi5wcm90b3R5cGUucmVuZGVyPWZ1bmN0aW9uKCl7dmFyIGksaixudW1Xb3JrZXJzLHJlZjtpZih0aGlzLnJ1bm5pbmcpe3Rocm93IG5ldyBFcnJvcihcIkFscmVhZHkgcnVubmluZ1wiKX1pZih0aGlzLm9wdGlvbnMud2lkdGg9PW51bGx8fHRoaXMub3B0aW9ucy5oZWlnaHQ9PW51bGwpe3Rocm93IG5ldyBFcnJvcihcIldpZHRoIGFuZCBoZWlnaHQgbXVzdCBiZSBzZXQgcHJpb3IgdG8gcmVuZGVyaW5nXCIpfXRoaXMucnVubmluZz10cnVlO3RoaXMubmV4dEZyYW1lPTA7dGhpcy5maW5pc2hlZEZyYW1lcz0wO3RoaXMuaW1hZ2VQYXJ0cz1mdW5jdGlvbigpe3ZhciBqLHJlZixyZXN1bHRzO3Jlc3VsdHM9W107Zm9yKGk9aj0wLHJlZj10aGlzLmZyYW1lcy5sZW5ndGg7MDw9cmVmP2o8cmVmOmo+cmVmO2k9MDw9cmVmPysrajotLWope3Jlc3VsdHMucHVzaChudWxsKX1yZXR1cm4gcmVzdWx0c30uY2FsbCh0aGlzKTtudW1Xb3JrZXJzPXRoaXMuc3Bhd25Xb3JrZXJzKCk7aWYodGhpcy5vcHRpb25zLmdsb2JhbFBhbGV0dGU9PT10cnVlKXt0aGlzLnJlbmRlck5leHRGcmFtZSgpfWVsc2V7Zm9yKGk9aj0wLHJlZj1udW1Xb3JrZXJzOzA8PXJlZj9qPHJlZjpqPnJlZjtpPTA8PXJlZj8rK2o6LS1qKXt0aGlzLnJlbmRlck5leHRGcmFtZSgpfX10aGlzLmVtaXQoXCJzdGFydFwiKTtyZXR1cm4gdGhpcy5lbWl0KFwicHJvZ3Jlc3NcIiwwKX07R0lGLnByb3RvdHlwZS5hYm9ydD1mdW5jdGlvbigpe3ZhciB3b3JrZXI7d2hpbGUodHJ1ZSl7d29ya2VyPXRoaXMuYWN0aXZlV29ya2Vycy5zaGlmdCgpO2lmKHdvcmtlcj09bnVsbCl7YnJlYWt9dGhpcy5sb2coXCJraWxsaW5nIGFjdGl2ZSB3b3JrZXJcIik7d29ya2VyLnRlcm1pbmF0ZSgpfXRoaXMucnVubmluZz1mYWxzZTtyZXR1cm4gdGhpcy5lbWl0KFwiYWJvcnRcIil9O0dJRi5wcm90b3R5cGUuc3Bhd25Xb3JrZXJzPWZ1bmN0aW9uKCl7dmFyIGosbnVtV29ya2VycyxyZWYscmVzdWx0cztudW1Xb3JrZXJzPU1hdGgubWluKHRoaXMub3B0aW9ucy53b3JrZXJzLHRoaXMuZnJhbWVzLmxlbmd0aCk7KGZ1bmN0aW9uKCl7cmVzdWx0cz1bXTtmb3IodmFyIGo9cmVmPXRoaXMuZnJlZVdvcmtlcnMubGVuZ3RoO3JlZjw9bnVtV29ya2Vycz9qPG51bVdvcmtlcnM6aj5udW1Xb3JrZXJzO3JlZjw9bnVtV29ya2Vycz9qKys6ai0tKXtyZXN1bHRzLnB1c2goail9cmV0dXJuIHJlc3VsdHN9KS5hcHBseSh0aGlzKS5mb3JFYWNoKGZ1bmN0aW9uKF90aGlzKXtyZXR1cm4gZnVuY3Rpb24oaSl7dmFyIHdvcmtlcjtfdGhpcy5sb2coXCJzcGF3bmluZyB3b3JrZXIgXCIraSk7d29ya2VyPW5ldyBXb3JrZXIoX3RoaXMub3B0aW9ucy53b3JrZXJTY3JpcHQpO3dvcmtlci5vbm1lc3NhZ2U9ZnVuY3Rpb24oZXZlbnQpe190aGlzLmFjdGl2ZVdvcmtlcnMuc3BsaWNlKF90aGlzLmFjdGl2ZVdvcmtlcnMuaW5kZXhPZih3b3JrZXIpLDEpO190aGlzLmZyZWVXb3JrZXJzLnB1c2god29ya2VyKTtyZXR1cm4gX3RoaXMuZnJhbWVGaW5pc2hlZChldmVudC5kYXRhKX07cmV0dXJuIF90aGlzLmZyZWVXb3JrZXJzLnB1c2god29ya2VyKX19KHRoaXMpKTtyZXR1cm4gbnVtV29ya2Vyc307R0lGLnByb3RvdHlwZS5mcmFtZUZpbmlzaGVkPWZ1bmN0aW9uKGZyYW1lKXt2YXIgaSxqLHJlZjt0aGlzLmxvZyhcImZyYW1lIFwiK2ZyYW1lLmluZGV4K1wiIGZpbmlzaGVkIC0gXCIrdGhpcy5hY3RpdmVXb3JrZXJzLmxlbmd0aCtcIiBhY3RpdmVcIik7dGhpcy5maW5pc2hlZEZyYW1lcysrO3RoaXMuZW1pdChcInByb2dyZXNzXCIsdGhpcy5maW5pc2hlZEZyYW1lcy90aGlzLmZyYW1lcy5sZW5ndGgpO3RoaXMuaW1hZ2VQYXJ0c1tmcmFtZS5pbmRleF09ZnJhbWU7aWYodGhpcy5vcHRpb25zLmdsb2JhbFBhbGV0dGU9PT10cnVlKXt0aGlzLm9wdGlvbnMuZ2xvYmFsUGFsZXR0ZT1mcmFtZS5nbG9iYWxQYWxldHRlO3RoaXMubG9nKFwiZ2xvYmFsIHBhbGV0dGUgYW5hbHl6ZWRcIik7aWYodGhpcy5mcmFtZXMubGVuZ3RoPjIpe2ZvcihpPWo9MSxyZWY9dGhpcy5mcmVlV29ya2Vycy5sZW5ndGg7MTw9cmVmP2o8cmVmOmo+cmVmO2k9MTw9cmVmPysrajotLWope3RoaXMucmVuZGVyTmV4dEZyYW1lKCl9fX1pZihpbmRleE9mLmNhbGwodGhpcy5pbWFnZVBhcnRzLG51bGwpPj0wKXtyZXR1cm4gdGhpcy5yZW5kZXJOZXh0RnJhbWUoKX1lbHNle3JldHVybiB0aGlzLmZpbmlzaFJlbmRlcmluZygpfX07R0lGLnByb3RvdHlwZS5maW5pc2hSZW5kZXJpbmc9ZnVuY3Rpb24oKXt2YXIgZGF0YSxmcmFtZSxpLGltYWdlLGosayxsLGxlbixsZW4xLGxlbjIsbGVuMyxvZmZzZXQscGFnZSxyZWYscmVmMSxyZWYyO2xlbj0wO3JlZj10aGlzLmltYWdlUGFydHM7Zm9yKGo9MCxsZW4xPXJlZi5sZW5ndGg7ajxsZW4xO2orKyl7ZnJhbWU9cmVmW2pdO2xlbis9KGZyYW1lLmRhdGEubGVuZ3RoLTEpKmZyYW1lLnBhZ2VTaXplK2ZyYW1lLmN1cnNvcn1sZW4rPWZyYW1lLnBhZ2VTaXplLWZyYW1lLmN1cnNvcjt0aGlzLmxvZyhcInJlbmRlcmluZyBmaW5pc2hlZCAtIGZpbGVzaXplIFwiK01hdGgucm91bmQobGVuLzFlMykrXCJrYlwiKTtkYXRhPW5ldyBVaW50OEFycmF5KGxlbik7b2Zmc2V0PTA7cmVmMT10aGlzLmltYWdlUGFydHM7Zm9yKGs9MCxsZW4yPXJlZjEubGVuZ3RoO2s8bGVuMjtrKyspe2ZyYW1lPXJlZjFba107cmVmMj1mcmFtZS5kYXRhO2ZvcihpPWw9MCxsZW4zPXJlZjIubGVuZ3RoO2w8bGVuMztpPSsrbCl7cGFnZT1yZWYyW2ldO2RhdGEuc2V0KHBhZ2Usb2Zmc2V0KTtpZihpPT09ZnJhbWUuZGF0YS5sZW5ndGgtMSl7b2Zmc2V0Kz1mcmFtZS5jdXJzb3J9ZWxzZXtvZmZzZXQrPWZyYW1lLnBhZ2VTaXplfX19aW1hZ2U9bmV3IEJsb2IoW2RhdGFdLHt0eXBlOlwiaW1hZ2UvZ2lmXCJ9KTtyZXR1cm4gdGhpcy5lbWl0KFwiZmluaXNoZWRcIixpbWFnZSxkYXRhKX07R0lGLnByb3RvdHlwZS5yZW5kZXJOZXh0RnJhbWU9ZnVuY3Rpb24oKXt2YXIgZnJhbWUsdGFzayx3b3JrZXI7aWYodGhpcy5mcmVlV29ya2Vycy5sZW5ndGg9PT0wKXt0aHJvdyBuZXcgRXJyb3IoXCJObyBmcmVlIHdvcmtlcnNcIil9aWYodGhpcy5uZXh0RnJhbWU+PXRoaXMuZnJhbWVzLmxlbmd0aCl7cmV0dXJufWZyYW1lPXRoaXMuZnJhbWVzW3RoaXMubmV4dEZyYW1lKytdO3dvcmtlcj10aGlzLmZyZWVXb3JrZXJzLnNoaWZ0KCk7dGFzaz10aGlzLmdldFRhc2soZnJhbWUpO3RoaXMubG9nKFwic3RhcnRpbmcgZnJhbWUgXCIrKHRhc2suaW5kZXgrMSkrXCIgb2YgXCIrdGhpcy5mcmFtZXMubGVuZ3RoKTt0aGlzLmFjdGl2ZVdvcmtlcnMucHVzaCh3b3JrZXIpO3JldHVybiB3b3JrZXIucG9zdE1lc3NhZ2UodGFzayl9O0dJRi5wcm90b3R5cGUuZ2V0Q29udGV4dERhdGE9ZnVuY3Rpb24oY3R4KXtyZXR1cm4gY3R4LmdldEltYWdlRGF0YSgwLDAsdGhpcy5vcHRpb25zLndpZHRoLHRoaXMub3B0aW9ucy5oZWlnaHQpLmRhdGF9O0dJRi5wcm90b3R5cGUuZ2V0SW1hZ2VEYXRhPWZ1bmN0aW9uKGltYWdlKXt2YXIgY3R4O2lmKHRoaXMuX2NhbnZhcz09bnVsbCl7dGhpcy5fY2FudmFzPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJjYW52YXNcIik7dGhpcy5fY2FudmFzLndpZHRoPXRoaXMub3B0aW9ucy53aWR0aDt0aGlzLl9jYW52YXMuaGVpZ2h0PXRoaXMub3B0aW9ucy5oZWlnaHR9Y3R4PXRoaXMuX2NhbnZhcy5nZXRDb250ZXh0KFwiMmRcIik7Y3R4LnNldEZpbGw9dGhpcy5vcHRpb25zLmJhY2tncm91bmQ7Y3R4LmZpbGxSZWN0KDAsMCx0aGlzLm9wdGlvbnMud2lkdGgsdGhpcy5vcHRpb25zLmhlaWdodCk7Y3R4LmRyYXdJbWFnZShpbWFnZSwwLDApO3JldHVybiB0aGlzLmdldENvbnRleHREYXRhKGN0eCl9O0dJRi5wcm90b3R5cGUuZ2V0VGFzaz1mdW5jdGlvbihmcmFtZSl7dmFyIGluZGV4LHRhc2s7aW5kZXg9dGhpcy5mcmFtZXMuaW5kZXhPZihmcmFtZSk7dGFzaz17aW5kZXg6aW5kZXgsbGFzdDppbmRleD09PXRoaXMuZnJhbWVzLmxlbmd0aC0xLGRlbGF5OmZyYW1lLmRlbGF5LGRpc3Bvc2U6ZnJhbWUuZGlzcG9zZSx0cmFuc3BhcmVudDpmcmFtZS50cmFuc3BhcmVudCx3aWR0aDp0aGlzLm9wdGlvbnMud2lkdGgsaGVpZ2h0OnRoaXMub3B0aW9ucy5oZWlnaHQscXVhbGl0eTp0aGlzLm9wdGlvbnMucXVhbGl0eSxkaXRoZXI6dGhpcy5vcHRpb25zLmRpdGhlcixnbG9iYWxQYWxldHRlOnRoaXMub3B0aW9ucy5nbG9iYWxQYWxldHRlLHJlcGVhdDp0aGlzLm9wdGlvbnMucmVwZWF0LGNhblRyYW5zZmVyOmJyb3dzZXIubmFtZT09PVwiY2hyb21lXCJ9O2lmKGZyYW1lLmRhdGEhPW51bGwpe3Rhc2suZGF0YT1mcmFtZS5kYXRhfWVsc2UgaWYoZnJhbWUuY29udGV4dCE9bnVsbCl7dGFzay5kYXRhPXRoaXMuZ2V0Q29udGV4dERhdGEoZnJhbWUuY29udGV4dCl9ZWxzZSBpZihmcmFtZS5pbWFnZSE9bnVsbCl7dGFzay5kYXRhPXRoaXMuZ2V0SW1hZ2VEYXRhKGZyYW1lLmltYWdlKX1lbHNle3Rocm93IG5ldyBFcnJvcihcIkludmFsaWQgZnJhbWVcIil9cmV0dXJuIHRhc2t9O0dJRi5wcm90b3R5cGUubG9nPWZ1bmN0aW9uKCl7dmFyIGFyZ3M7YXJncz0xPD1hcmd1bWVudHMubGVuZ3RoP3NsaWNlLmNhbGwoYXJndW1lbnRzLDApOltdO2lmKCF0aGlzLm9wdGlvbnMuZGVidWcpe3JldHVybn1yZXR1cm4gY29uc29sZS5sb2cuYXBwbHkoY29uc29sZSxhcmdzKX07cmV0dXJuIEdJRn0oRXZlbnRFbWl0dGVyKX0se1wiLi9HSUZFbmNvZGVyLmpzXCI6MixcIi4vYnJvd3Nlci5jb2ZmZWVcIjo1LFwiLi9naWYud29ya2VyLmNvZmZlZVwiOjcsZXZlbnRzOjF9XSw3OltmdW5jdGlvbihyZXF1aXJlLG1vZHVsZSxleHBvcnRzKXt2YXIgR0lGRW5jb2RlcixyZW5kZXJGcmFtZTtHSUZFbmNvZGVyPXJlcXVpcmUoXCIuL0dJRkVuY29kZXIuanNcIik7cmVuZGVyRnJhbWU9ZnVuY3Rpb24oZnJhbWUpe3ZhciBlbmNvZGVyLHBhZ2Usc3RyZWFtLHRyYW5zZmVyO2VuY29kZXI9bmV3IEdJRkVuY29kZXIoZnJhbWUud2lkdGgsZnJhbWUuaGVpZ2h0KTtpZihmcmFtZS5pbmRleD09PTApe2VuY29kZXIud3JpdGVIZWFkZXIoKX1lbHNle2VuY29kZXIuZmlyc3RGcmFtZT1mYWxzZX1lbmNvZGVyLnNldFRyYW5zcGFyZW50KGZyYW1lLnRyYW5zcGFyZW50KTtlbmNvZGVyLnNldERpc3Bvc2UoZnJhbWUuZGlzcG9zZSk7ZW5jb2Rlci5zZXRSZXBlYXQoZnJhbWUucmVwZWF0KTtlbmNvZGVyLnNldERlbGF5KGZyYW1lLmRlbGF5KTtlbmNvZGVyLnNldFF1YWxpdHkoZnJhbWUucXVhbGl0eSk7ZW5jb2Rlci5zZXREaXRoZXIoZnJhbWUuZGl0aGVyKTtlbmNvZGVyLnNldEdsb2JhbFBhbGV0dGUoZnJhbWUuZ2xvYmFsUGFsZXR0ZSk7ZW5jb2Rlci5hZGRGcmFtZShmcmFtZS5kYXRhKTtpZihmcmFtZS5sYXN0KXtlbmNvZGVyLmZpbmlzaCgpfWlmKGZyYW1lLmdsb2JhbFBhbGV0dGU9PT10cnVlKXtmcmFtZS5nbG9iYWxQYWxldHRlPWVuY29kZXIuZ2V0R2xvYmFsUGFsZXR0ZSgpfXN0cmVhbT1lbmNvZGVyLnN0cmVhbSgpO2ZyYW1lLmRhdGE9c3RyZWFtLnBhZ2VzO2ZyYW1lLmN1cnNvcj1zdHJlYW0uY3Vyc29yO2ZyYW1lLnBhZ2VTaXplPXN0cmVhbS5jb25zdHJ1Y3Rvci5wYWdlU2l6ZTtpZihmcmFtZS5jYW5UcmFuc2Zlcil7dHJhbnNmZXI9ZnVuY3Rpb24oKXt2YXIgaSxsZW4scmVmLHJlc3VsdHM7cmVmPWZyYW1lLmRhdGE7cmVzdWx0cz1bXTtmb3IoaT0wLGxlbj1yZWYubGVuZ3RoO2k8bGVuO2krKyl7cGFnZT1yZWZbaV07cmVzdWx0cy5wdXNoKHBhZ2UuYnVmZmVyKX1yZXR1cm4gcmVzdWx0c30oKTtyZXR1cm4gc2VsZi5wb3N0TWVzc2FnZShmcmFtZSx0cmFuc2Zlcil9ZWxzZXtyZXR1cm4gc2VsZi5wb3N0TWVzc2FnZShmcmFtZSl9fTtzZWxmLm9ubWVzc2FnZT1mdW5jdGlvbihldmVudCl7cmV0dXJuIHJlbmRlckZyYW1lKGV2ZW50LmRhdGEpfX0se1wiLi9HSUZFbmNvZGVyLmpzXCI6Mn1dfSx7fSxbNl0pKDYpfSk7XHJcbi8vIyBzb3VyY2VNYXBwaW5nVVJMPWdpZi5qcy5tYXBcclxuIiwiOyhmdW5jdGlvbigpIHtcclxuXHJcbmlmICh0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2YgbW9kdWxlLmV4cG9ydHMgIT09ICd1bmRlZmluZWQnKSB7XHJcbiAgdmFyIFRhciA9IHJlcXVpcmUoJy4vdGFyLmpzJyk7XHJcbiAgdmFyIGRvd25sb2FkID0gcmVxdWlyZSgnLi9kb3dubG9hZC5qcycpO1xyXG4gIHZhciBHSUYgPSByZXF1aXJlKCcuL2dpZi5qcycpO1xyXG59XHJcblxyXG5cInVzZSBzdHJpY3RcIjtcclxuXHJcbnZhciBvYmplY3RUeXBlcyA9IHtcclxuJ2Z1bmN0aW9uJzogdHJ1ZSxcclxuJ29iamVjdCc6IHRydWVcclxufTtcclxuXHJcbmZ1bmN0aW9uIGNoZWNrR2xvYmFsKHZhbHVlKSB7XHJcbiAgICByZXR1cm4gKHZhbHVlICYmIHZhbHVlLk9iamVjdCA9PT0gT2JqZWN0KSA/IHZhbHVlIDogbnVsbDtcclxuICB9XHJcblxyXG4vKiogQnVpbHQtaW4gbWV0aG9kIHJlZmVyZW5jZXMgd2l0aG91dCBhIGRlcGVuZGVuY3kgb24gYHJvb3RgLiAqL1xyXG52YXIgZnJlZVBhcnNlRmxvYXQgPSBwYXJzZUZsb2F0LFxyXG4gIGZyZWVQYXJzZUludCA9IHBhcnNlSW50O1xyXG5cclxuLyoqIERldGVjdCBmcmVlIHZhcmlhYmxlIGBleHBvcnRzYC4gKi9cclxudmFyIGZyZWVFeHBvcnRzID0gKG9iamVjdFR5cGVzW3R5cGVvZiBleHBvcnRzXSAmJiBleHBvcnRzICYmICFleHBvcnRzLm5vZGVUeXBlKVxyXG4/IGV4cG9ydHNcclxuOiB1bmRlZmluZWQ7XHJcblxyXG4vKiogRGV0ZWN0IGZyZWUgdmFyaWFibGUgYG1vZHVsZWAuICovXHJcbnZhciBmcmVlTW9kdWxlID0gKG9iamVjdFR5cGVzW3R5cGVvZiBtb2R1bGVdICYmIG1vZHVsZSAmJiAhbW9kdWxlLm5vZGVUeXBlKVxyXG4/IG1vZHVsZVxyXG46IHVuZGVmaW5lZDtcclxuXHJcbi8qKiBEZXRlY3QgdGhlIHBvcHVsYXIgQ29tbW9uSlMgZXh0ZW5zaW9uIGBtb2R1bGUuZXhwb3J0c2AuICovXHJcbnZhciBtb2R1bGVFeHBvcnRzID0gKGZyZWVNb2R1bGUgJiYgZnJlZU1vZHVsZS5leHBvcnRzID09PSBmcmVlRXhwb3J0cylcclxuPyBmcmVlRXhwb3J0c1xyXG46IHVuZGVmaW5lZDtcclxuXHJcbi8qKiBEZXRlY3QgZnJlZSB2YXJpYWJsZSBgZ2xvYmFsYCBmcm9tIE5vZGUuanMuICovXHJcbnZhciBmcmVlR2xvYmFsID0gY2hlY2tHbG9iYWwoZnJlZUV4cG9ydHMgJiYgZnJlZU1vZHVsZSAmJiB0eXBlb2YgZ2xvYmFsID09ICdvYmplY3QnICYmIGdsb2JhbCk7XHJcblxyXG4vKiogRGV0ZWN0IGZyZWUgdmFyaWFibGUgYHNlbGZgLiAqL1xyXG52YXIgZnJlZVNlbGYgPSBjaGVja0dsb2JhbChvYmplY3RUeXBlc1t0eXBlb2Ygc2VsZl0gJiYgc2VsZik7XHJcblxyXG4vKiogRGV0ZWN0IGZyZWUgdmFyaWFibGUgYHdpbmRvd2AuICovXHJcbnZhciBmcmVlV2luZG93ID0gY2hlY2tHbG9iYWwob2JqZWN0VHlwZXNbdHlwZW9mIHdpbmRvd10gJiYgd2luZG93KTtcclxuXHJcbi8qKiBEZXRlY3QgYHRoaXNgIGFzIHRoZSBnbG9iYWwgb2JqZWN0LiAqL1xyXG52YXIgdGhpc0dsb2JhbCA9IGNoZWNrR2xvYmFsKG9iamVjdFR5cGVzW3R5cGVvZiB0aGlzXSAmJiB0aGlzKTtcclxuXHJcbi8qKlxyXG4qIFVzZWQgYXMgYSByZWZlcmVuY2UgdG8gdGhlIGdsb2JhbCBvYmplY3QuXHJcbipcclxuKiBUaGUgYHRoaXNgIHZhbHVlIGlzIHVzZWQgaWYgaXQncyB0aGUgZ2xvYmFsIG9iamVjdCB0byBhdm9pZCBHcmVhc2Vtb25rZXknc1xyXG4qIHJlc3RyaWN0ZWQgYHdpbmRvd2Agb2JqZWN0LCBvdGhlcndpc2UgdGhlIGB3aW5kb3dgIG9iamVjdCBpcyB1c2VkLlxyXG4qL1xyXG52YXIgcm9vdCA9IGZyZWVHbG9iYWwgfHxcclxuKChmcmVlV2luZG93ICE9PSAodGhpc0dsb2JhbCAmJiB0aGlzR2xvYmFsLndpbmRvdykpICYmIGZyZWVXaW5kb3cpIHx8XHJcbiAgZnJlZVNlbGYgfHwgdGhpc0dsb2JhbCB8fCBGdW5jdGlvbigncmV0dXJuIHRoaXMnKSgpO1xyXG5cclxuaWYoICEoJ2djJyBpbiB3aW5kb3cgKSApIHtcclxuXHR3aW5kb3cuZ2MgPSBmdW5jdGlvbigpe31cclxufVxyXG5cclxuaWYgKCFIVE1MQ2FudmFzRWxlbWVudC5wcm90b3R5cGUudG9CbG9iKSB7XHJcbiBPYmplY3QuZGVmaW5lUHJvcGVydHkoSFRNTENhbnZhc0VsZW1lbnQucHJvdG90eXBlLCAndG9CbG9iJywge1xyXG4gIHZhbHVlOiBmdW5jdGlvbiAoY2FsbGJhY2ssIHR5cGUsIHF1YWxpdHkpIHtcclxuXHJcbiAgICB2YXIgYmluU3RyID0gYXRvYiggdGhpcy50b0RhdGFVUkwodHlwZSwgcXVhbGl0eSkuc3BsaXQoJywnKVsxXSApLFxyXG4gICAgICAgIGxlbiA9IGJpblN0ci5sZW5ndGgsXHJcbiAgICAgICAgYXJyID0gbmV3IFVpbnQ4QXJyYXkobGVuKTtcclxuXHJcbiAgICBmb3IgKHZhciBpPTA7IGk8bGVuOyBpKysgKSB7XHJcbiAgICAgYXJyW2ldID0gYmluU3RyLmNoYXJDb2RlQXQoaSk7XHJcbiAgICB9XHJcblxyXG4gICAgY2FsbGJhY2soIG5ldyBCbG9iKCBbYXJyXSwge3R5cGU6IHR5cGUgfHwgJ2ltYWdlL3BuZyd9ICkgKTtcclxuICB9XHJcbiB9KTtcclxufVxyXG5cclxuLy8gQGxpY2Vuc2UgaHR0cDovL29wZW5zb3VyY2Uub3JnL2xpY2Vuc2VzL01JVFxyXG4vLyBjb3B5cmlnaHQgUGF1bCBJcmlzaCAyMDE1XHJcblxyXG5cclxuLy8gRGF0ZS5ub3coKSBpcyBzdXBwb3J0ZWQgZXZlcnl3aGVyZSBleGNlcHQgSUU4LiBGb3IgSUU4IHdlIHVzZSB0aGUgRGF0ZS5ub3cgcG9seWZpbGxcclxuLy8gICBnaXRodWIuY29tL0ZpbmFuY2lhbC1UaW1lcy9wb2x5ZmlsbC1zZXJ2aWNlL2Jsb2IvbWFzdGVyL3BvbHlmaWxscy9EYXRlLm5vdy9wb2x5ZmlsbC5qc1xyXG4vLyBhcyBTYWZhcmkgNiBkb2Vzbid0IGhhdmUgc3VwcG9ydCBmb3IgTmF2aWdhdGlvblRpbWluZywgd2UgdXNlIGEgRGF0ZS5ub3coKSB0aW1lc3RhbXAgZm9yIHJlbGF0aXZlIHZhbHVlc1xyXG5cclxuLy8gaWYgeW91IHdhbnQgdmFsdWVzIHNpbWlsYXIgdG8gd2hhdCB5b3UnZCBnZXQgd2l0aCByZWFsIHBlcmYubm93LCBwbGFjZSB0aGlzIHRvd2FyZHMgdGhlIGhlYWQgb2YgdGhlIHBhZ2VcclxuLy8gYnV0IGluIHJlYWxpdHksIHlvdSdyZSBqdXN0IGdldHRpbmcgdGhlIGRlbHRhIGJldHdlZW4gbm93KCkgY2FsbHMsIHNvIGl0J3Mgbm90IHRlcnJpYmx5IGltcG9ydGFudCB3aGVyZSBpdCdzIHBsYWNlZFxyXG5cclxuXHJcbihmdW5jdGlvbigpe1xyXG5cclxuICBpZiAoXCJwZXJmb3JtYW5jZVwiIGluIHdpbmRvdyA9PSBmYWxzZSkge1xyXG4gICAgICB3aW5kb3cucGVyZm9ybWFuY2UgPSB7fTtcclxuICB9XHJcblxyXG4gIERhdGUubm93ID0gKERhdGUubm93IHx8IGZ1bmN0aW9uICgpIHsgIC8vIHRoYW5rcyBJRThcclxuXHQgIHJldHVybiBuZXcgRGF0ZSgpLmdldFRpbWUoKTtcclxuICB9KTtcclxuXHJcbiAgaWYgKFwibm93XCIgaW4gd2luZG93LnBlcmZvcm1hbmNlID09IGZhbHNlKXtcclxuXHJcbiAgICB2YXIgbm93T2Zmc2V0ID0gRGF0ZS5ub3coKTtcclxuXHJcbiAgICBpZiAocGVyZm9ybWFuY2UudGltaW5nICYmIHBlcmZvcm1hbmNlLnRpbWluZy5uYXZpZ2F0aW9uU3RhcnQpe1xyXG4gICAgICBub3dPZmZzZXQgPSBwZXJmb3JtYW5jZS50aW1pbmcubmF2aWdhdGlvblN0YXJ0XHJcbiAgICB9XHJcblxyXG4gICAgd2luZG93LnBlcmZvcm1hbmNlLm5vdyA9IGZ1bmN0aW9uIG5vdygpe1xyXG4gICAgICByZXR1cm4gRGF0ZS5ub3coKSAtIG5vd09mZnNldDtcclxuICAgIH1cclxuICB9XHJcblxyXG59KSgpO1xyXG5cclxuXHJcbmZ1bmN0aW9uIHBhZCggbiApIHtcclxuXHRyZXR1cm4gU3RyaW5nKFwiMDAwMDAwMFwiICsgbikuc2xpY2UoLTcpO1xyXG59XHJcbi8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL0FkZC1vbnMvQ29kZV9zbmlwcGV0cy9UaW1lcnNcclxuXHJcbnZhciBnX3N0YXJ0VGltZSA9IHdpbmRvdy5EYXRlLm5vdygpO1xyXG5cclxuZnVuY3Rpb24gZ3VpZCgpIHtcclxuXHRmdW5jdGlvbiBzNCgpIHtcclxuXHRcdHJldHVybiBNYXRoLmZsb29yKCgxICsgTWF0aC5yYW5kb20oKSkgKiAweDEwMDAwKS50b1N0cmluZygxNikuc3Vic3RyaW5nKDEpO1xyXG5cdH1cclxuXHRyZXR1cm4gczQoKSArIHM0KCkgKyAnLScgKyBzNCgpICsgJy0nICsgczQoKSArICctJyArIHM0KCkgKyAnLScgKyBzNCgpICsgczQoKSArIHM0KCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIENDRnJhbWVFbmNvZGVyKCBzZXR0aW5ncyApIHtcclxuXHJcblx0dmFyIF9oYW5kbGVycyA9IHt9O1xyXG5cclxuXHR0aGlzLnNldHRpbmdzID0gc2V0dGluZ3M7XHJcblxyXG5cdHRoaXMub24gPSBmdW5jdGlvbihldmVudCwgaGFuZGxlcikge1xyXG5cclxuXHRcdF9oYW5kbGVyc1tldmVudF0gPSBoYW5kbGVyO1xyXG5cclxuXHR9O1xyXG5cclxuXHR0aGlzLmVtaXQgPSBmdW5jdGlvbihldmVudCkge1xyXG5cclxuXHRcdHZhciBoYW5kbGVyID0gX2hhbmRsZXJzW2V2ZW50XTtcclxuXHRcdGlmIChoYW5kbGVyKSB7XHJcblxyXG5cdFx0XHRoYW5kbGVyLmFwcGx5KG51bGwsIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSkpO1xyXG5cclxuXHRcdH1cclxuXHJcblx0fTtcclxuXHJcblx0dGhpcy5maWxlbmFtZSA9IHNldHRpbmdzLm5hbWUgfHwgZ3VpZCgpO1xyXG5cdHRoaXMuZXh0ZW5zaW9uID0gJyc7XHJcblx0dGhpcy5taW1lVHlwZSA9ICcnO1xyXG5cclxufVxyXG5cclxuQ0NGcmFtZUVuY29kZXIucHJvdG90eXBlLnN0YXJ0ID0gZnVuY3Rpb24oKXt9O1xyXG5DQ0ZyYW1lRW5jb2Rlci5wcm90b3R5cGUuc3RvcCA9IGZ1bmN0aW9uKCl7fTtcclxuQ0NGcmFtZUVuY29kZXIucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKCl7fTtcclxuQ0NGcmFtZUVuY29kZXIucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbigpe307XHJcbkNDRnJhbWVFbmNvZGVyLnByb3RvdHlwZS5kaXNwb3NlID0gZnVuY3Rpb24oKXt9O1xyXG5DQ0ZyYW1lRW5jb2Rlci5wcm90b3R5cGUuc2FmZVRvUHJvY2VlZCA9IGZ1bmN0aW9uKCl7IHJldHVybiB0cnVlOyB9O1xyXG5DQ0ZyYW1lRW5jb2Rlci5wcm90b3R5cGUuc3RlcCA9IGZ1bmN0aW9uKCkgeyBjb25zb2xlLmxvZyggJ1N0ZXAgbm90IHNldCEnICkgfVxyXG5cclxuZnVuY3Rpb24gQ0NUYXJFbmNvZGVyKCBzZXR0aW5ncyApIHtcclxuXHJcblx0Q0NGcmFtZUVuY29kZXIuY2FsbCggdGhpcywgc2V0dGluZ3MgKTtcclxuXHJcblx0dGhpcy5leHRlbnNpb24gPSAnLnRhcidcclxuXHR0aGlzLm1pbWVUeXBlID0gJ2FwcGxpY2F0aW9uL3gtdGFyJ1xyXG5cdHRoaXMuZmlsZUV4dGVuc2lvbiA9ICcnO1xyXG5cclxuXHR0aGlzLnRhcGUgPSBudWxsXHJcblx0dGhpcy5jb3VudCA9IDA7XHJcblxyXG59XHJcblxyXG5DQ1RhckVuY29kZXIucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZSggQ0NGcmFtZUVuY29kZXIucHJvdG90eXBlICk7XHJcblxyXG5DQ1RhckVuY29kZXIucHJvdG90eXBlLnN0YXJ0ID0gZnVuY3Rpb24oKXtcclxuXHJcblx0dGhpcy5kaXNwb3NlKCk7XHJcblxyXG59O1xyXG5cclxuQ0NUYXJFbmNvZGVyLnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbiggYmxvYiApIHtcclxuXHJcblx0dmFyIGZpbGVSZWFkZXIgPSBuZXcgRmlsZVJlYWRlcigpO1xyXG5cdGZpbGVSZWFkZXIub25sb2FkID0gZnVuY3Rpb24oKSB7XHJcblx0XHR0aGlzLnRhcGUuYXBwZW5kKCBwYWQoIHRoaXMuY291bnQgKSArIHRoaXMuZmlsZUV4dGVuc2lvbiwgbmV3IFVpbnQ4QXJyYXkoIGZpbGVSZWFkZXIucmVzdWx0ICkgKTtcclxuXHJcblx0XHQvL2lmKCB0aGlzLnNldHRpbmdzLmF1dG9TYXZlVGltZSA+IDAgJiYgKCB0aGlzLmZyYW1lcy5sZW5ndGggLyB0aGlzLnNldHRpbmdzLmZyYW1lcmF0ZSApID49IHRoaXMuc2V0dGluZ3MuYXV0b1NhdmVUaW1lICkge1xyXG5cclxuXHRcdHRoaXMuY291bnQrKztcclxuXHRcdHRoaXMuc3RlcCgpO1xyXG5cdH0uYmluZCggdGhpcyApO1xyXG5cdGZpbGVSZWFkZXIucmVhZEFzQXJyYXlCdWZmZXIoYmxvYik7XHJcblxyXG59XHJcblxyXG5DQ1RhckVuY29kZXIucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbiggY2FsbGJhY2sgKSB7XHJcblxyXG5cdGNhbGxiYWNrKCB0aGlzLnRhcGUuc2F2ZSgpICk7XHJcblxyXG59XHJcblxyXG5DQ1RhckVuY29kZXIucHJvdG90eXBlLmRpc3Bvc2UgPSBmdW5jdGlvbigpIHtcclxuXHJcblx0dGhpcy50YXBlID0gbmV3IFRhcigpO1xyXG5cdHRoaXMuY291bnQgPSAwO1xyXG5cclxufVxyXG5cclxuZnVuY3Rpb24gQ0NQTkdFbmNvZGVyKCBzZXR0aW5ncyApIHtcclxuXHJcblx0Q0NUYXJFbmNvZGVyLmNhbGwoIHRoaXMsIHNldHRpbmdzICk7XHJcblxyXG5cdHRoaXMudHlwZSA9ICdpbWFnZS9wbmcnO1xyXG5cdHRoaXMuZmlsZUV4dGVuc2lvbiA9ICcucG5nJztcclxuXHJcbn1cclxuXHJcbkNDUE5HRW5jb2Rlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKCBDQ1RhckVuY29kZXIucHJvdG90eXBlICk7XHJcblxyXG5DQ1BOR0VuY29kZXIucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKCBjYW52YXMgKSB7XHJcblxyXG5cdGNhbnZhcy50b0Jsb2IoIGZ1bmN0aW9uKCBibG9iICkge1xyXG5cdFx0Q0NUYXJFbmNvZGVyLnByb3RvdHlwZS5hZGQuY2FsbCggdGhpcywgYmxvYiApO1xyXG5cdH0uYmluZCggdGhpcyApLCB0aGlzLnR5cGUgKVxyXG5cclxufVxyXG5cclxuZnVuY3Rpb24gQ0NKUEVHRW5jb2Rlciggc2V0dGluZ3MgKSB7XHJcblxyXG5cdENDVGFyRW5jb2Rlci5jYWxsKCB0aGlzLCBzZXR0aW5ncyApO1xyXG5cclxuXHR0aGlzLnR5cGUgPSAnaW1hZ2UvanBlZyc7XHJcblx0dGhpcy5maWxlRXh0ZW5zaW9uID0gJy5qcGcnO1xyXG5cdHRoaXMucXVhbGl0eSA9ICggc2V0dGluZ3MucXVhbGl0eSAvIDEwMCApIHx8IC44O1xyXG5cclxufVxyXG5cclxuQ0NKUEVHRW5jb2Rlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKCBDQ1RhckVuY29kZXIucHJvdG90eXBlICk7XHJcblxyXG5DQ0pQRUdFbmNvZGVyLnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbiggY2FudmFzICkge1xyXG5cclxuXHRjYW52YXMudG9CbG9iKCBmdW5jdGlvbiggYmxvYiApIHtcclxuXHRcdENDVGFyRW5jb2Rlci5wcm90b3R5cGUuYWRkLmNhbGwoIHRoaXMsIGJsb2IgKTtcclxuXHR9LmJpbmQoIHRoaXMgKSwgdGhpcy50eXBlLCB0aGlzLnF1YWxpdHkgKVxyXG5cclxufVxyXG5cclxuLypcclxuXHJcblx0V2ViTSBFbmNvZGVyXHJcblxyXG4qL1xyXG5cclxuZnVuY3Rpb24gQ0NXZWJNRW5jb2Rlciggc2V0dGluZ3MgKSB7XHJcblxyXG5cdHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCAnY2FudmFzJyApO1xyXG5cdGlmKCBjYW52YXMudG9EYXRhVVJMKCAnaW1hZ2Uvd2VicCcgKS5zdWJzdHIoNSwxMCkgIT09ICdpbWFnZS93ZWJwJyApe1xyXG5cdFx0Y29uc29sZS5sb2coIFwiV2ViUCBub3Qgc3VwcG9ydGVkIC0gdHJ5IGFub3RoZXIgZXhwb3J0IGZvcm1hdFwiIClcclxuXHR9XHJcblxyXG5cdENDRnJhbWVFbmNvZGVyLmNhbGwoIHRoaXMsIHNldHRpbmdzICk7XHJcblxyXG5cdHRoaXMucXVhbGl0eSA9ICggc2V0dGluZ3MucXVhbGl0eSAvIDEwMCApIHx8IC44O1xyXG5cclxuXHR0aGlzLmV4dGVuc2lvbiA9ICcud2VibSdcclxuXHR0aGlzLm1pbWVUeXBlID0gJ3ZpZGVvL3dlYm0nXHJcblx0dGhpcy5iYXNlRmlsZW5hbWUgPSB0aGlzLmZpbGVuYW1lO1xyXG5cclxuXHR0aGlzLmZyYW1lcyA9IFtdO1xyXG5cdHRoaXMucGFydCA9IDE7XHJcblxyXG4gIHRoaXMudmlkZW9Xcml0ZXIgPSBuZXcgV2ViTVdyaXRlcih7XHJcbiAgICBxdWFsaXR5OiB0aGlzLnF1YWxpdHksXHJcbiAgICBmaWxlV3JpdGVyOiBudWxsLFxyXG4gICAgZmQ6IG51bGwsXHJcbiAgICBmcmFtZVJhdGU6IHNldHRpbmdzLmZyYW1lcmF0ZVxyXG59KTtcclxuXHJcblxyXG59XHJcblxyXG5DQ1dlYk1FbmNvZGVyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoIENDRnJhbWVFbmNvZGVyLnByb3RvdHlwZSApO1xyXG5cclxuQ0NXZWJNRW5jb2Rlci5wcm90b3R5cGUuc3RhcnQgPSBmdW5jdGlvbiggY2FudmFzICkge1xyXG5cclxuXHR0aGlzLmRpc3Bvc2UoKTtcclxuXHJcbn1cclxuXHJcbkNDV2ViTUVuY29kZXIucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKCBjYW52YXMgKSB7XHJcblxyXG4gIHRoaXMudmlkZW9Xcml0ZXIuYWRkRnJhbWUoY2FudmFzKTtcclxuXHJcblx0Ly90aGlzLmZyYW1lcy5wdXNoKCBjYW52YXMudG9EYXRhVVJMKCdpbWFnZS93ZWJwJywgdGhpcy5xdWFsaXR5KSApO1xyXG5cclxuXHRpZiggdGhpcy5zZXR0aW5ncy5hdXRvU2F2ZVRpbWUgPiAwICYmICggdGhpcy5mcmFtZXMubGVuZ3RoIC8gdGhpcy5zZXR0aW5ncy5mcmFtZXJhdGUgKSA+PSB0aGlzLnNldHRpbmdzLmF1dG9TYXZlVGltZSApIHtcclxuXHRcdHRoaXMuc2F2ZSggZnVuY3Rpb24oIGJsb2IgKSB7XHJcblx0XHRcdHRoaXMuZmlsZW5hbWUgPSB0aGlzLmJhc2VGaWxlbmFtZSArICctcGFydC0nICsgcGFkKCB0aGlzLnBhcnQgKTtcclxuXHRcdFx0ZG93bmxvYWQoIGJsb2IsIHRoaXMuZmlsZW5hbWUgKyB0aGlzLmV4dGVuc2lvbiwgdGhpcy5taW1lVHlwZSApO1xyXG5cdFx0XHR0aGlzLmRpc3Bvc2UoKTtcclxuXHRcdFx0dGhpcy5wYXJ0Kys7XHJcblx0XHRcdHRoaXMuZmlsZW5hbWUgPSB0aGlzLmJhc2VGaWxlbmFtZSArICctcGFydC0nICsgcGFkKCB0aGlzLnBhcnQgKTtcclxuXHRcdFx0dGhpcy5zdGVwKCk7XHJcblx0XHR9LmJpbmQoIHRoaXMgKSApXHJcblx0fSBlbHNlIHtcclxuXHRcdHRoaXMuc3RlcCgpO1xyXG5cdH1cclxuXHJcbn1cclxuXHJcbkNDV2ViTUVuY29kZXIucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbiggY2FsbGJhY2sgKSB7XHJcblxyXG4vL1x0aWYoICF0aGlzLmZyYW1lcy5sZW5ndGggKSByZXR1cm47XHJcblxyXG4gIHRoaXMudmlkZW9Xcml0ZXIuY29tcGxldGUoKS50aGVuKGNhbGxiYWNrKTtcclxuXHJcblx0Lyp2YXIgd2VibSA9IFdoYW1teS5mcm9tSW1hZ2VBcnJheSggdGhpcy5mcmFtZXMsIHRoaXMuc2V0dGluZ3MuZnJhbWVyYXRlIClcclxuXHR2YXIgYmxvYiA9IG5ldyBCbG9iKCBbIHdlYm0gXSwgeyB0eXBlOiBcIm9jdGV0L3N0cmVhbVwiIH0gKTtcclxuXHRjYWxsYmFjayggYmxvYiApOyovXHJcblxyXG59XHJcblxyXG5DQ1dlYk1FbmNvZGVyLnByb3RvdHlwZS5kaXNwb3NlID0gZnVuY3Rpb24oIGNhbnZhcyApIHtcclxuXHJcblx0dGhpcy5mcmFtZXMgPSBbXTtcclxuXHJcbn1cclxuXHJcbmZ1bmN0aW9uIENDRkZNcGVnU2VydmVyRW5jb2Rlciggc2V0dGluZ3MgKSB7XHJcblxyXG5cdENDRnJhbWVFbmNvZGVyLmNhbGwoIHRoaXMsIHNldHRpbmdzICk7XHJcblxyXG5cdHNldHRpbmdzLnF1YWxpdHkgPSAoIHNldHRpbmdzLnF1YWxpdHkgLyAxMDAgKSB8fCAuODtcclxuXHJcblx0dGhpcy5lbmNvZGVyID0gbmV3IEZGTXBlZ1NlcnZlci5WaWRlbyggc2V0dGluZ3MgKTtcclxuICAgIHRoaXMuZW5jb2Rlci5vbiggJ3Byb2Nlc3MnLCBmdW5jdGlvbigpIHtcclxuICAgICAgICB0aGlzLmVtaXQoICdwcm9jZXNzJyApXHJcbiAgICB9LmJpbmQoIHRoaXMgKSApO1xyXG4gICAgdGhpcy5lbmNvZGVyLm9uKCdmaW5pc2hlZCcsIGZ1bmN0aW9uKCB1cmwsIHNpemUgKSB7XHJcbiAgICAgICAgdmFyIGNiID0gdGhpcy5jYWxsYmFjaztcclxuICAgICAgICBpZiAoIGNiICkge1xyXG4gICAgICAgICAgICB0aGlzLmNhbGxiYWNrID0gdW5kZWZpbmVkO1xyXG4gICAgICAgICAgICBjYiggdXJsLCBzaXplICk7XHJcbiAgICAgICAgfVxyXG4gICAgfS5iaW5kKCB0aGlzICkgKTtcclxuICAgIHRoaXMuZW5jb2Rlci5vbiggJ3Byb2dyZXNzJywgZnVuY3Rpb24oIHByb2dyZXNzICkge1xyXG4gICAgICAgIGlmICggdGhpcy5zZXR0aW5ncy5vblByb2dyZXNzICkge1xyXG4gICAgICAgICAgICB0aGlzLnNldHRpbmdzLm9uUHJvZ3Jlc3MoIHByb2dyZXNzIClcclxuICAgICAgICB9XHJcbiAgICB9LmJpbmQoIHRoaXMgKSApO1xyXG4gICAgdGhpcy5lbmNvZGVyLm9uKCAnZXJyb3InLCBmdW5jdGlvbiggZGF0YSApIHtcclxuICAgICAgICBhbGVydChKU09OLnN0cmluZ2lmeShkYXRhLCBudWxsLCAyKSk7XHJcbiAgICB9LmJpbmQoIHRoaXMgKSApO1xyXG5cclxufVxyXG5cclxuQ0NGRk1wZWdTZXJ2ZXJFbmNvZGVyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoIENDRnJhbWVFbmNvZGVyLnByb3RvdHlwZSApO1xyXG5cclxuQ0NGRk1wZWdTZXJ2ZXJFbmNvZGVyLnByb3RvdHlwZS5zdGFydCA9IGZ1bmN0aW9uKCkge1xyXG5cclxuXHR0aGlzLmVuY29kZXIuc3RhcnQoIHRoaXMuc2V0dGluZ3MgKTtcclxuXHJcbn07XHJcblxyXG5DQ0ZGTXBlZ1NlcnZlckVuY29kZXIucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKCBjYW52YXMgKSB7XHJcblxyXG5cdHRoaXMuZW5jb2Rlci5hZGQoIGNhbnZhcyApO1xyXG5cclxufVxyXG5cclxuQ0NGRk1wZWdTZXJ2ZXJFbmNvZGVyLnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oIGNhbGxiYWNrICkge1xyXG5cclxuICAgIHRoaXMuY2FsbGJhY2sgPSBjYWxsYmFjaztcclxuICAgIHRoaXMuZW5jb2Rlci5lbmQoKTtcclxuXHJcbn1cclxuXHJcbkNDRkZNcGVnU2VydmVyRW5jb2Rlci5wcm90b3R5cGUuc2FmZVRvUHJvY2VlZCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZW5jb2Rlci5zYWZlVG9Qcm9jZWVkKCk7XHJcbn07XHJcblxyXG4vKlxyXG5cdEhUTUxDYW52YXNFbGVtZW50LmNhcHR1cmVTdHJlYW0oKVxyXG4qL1xyXG5cclxuZnVuY3Rpb24gQ0NTdHJlYW1FbmNvZGVyKCBzZXR0aW5ncyApIHtcclxuXHJcblx0Q0NGcmFtZUVuY29kZXIuY2FsbCggdGhpcywgc2V0dGluZ3MgKTtcclxuXHJcblx0dGhpcy5mcmFtZXJhdGUgPSB0aGlzLnNldHRpbmdzLmZyYW1lcmF0ZTtcclxuXHR0aGlzLnR5cGUgPSAndmlkZW8vd2VibSc7XHJcblx0dGhpcy5leHRlbnNpb24gPSAnLndlYm0nO1xyXG5cdHRoaXMuc3RyZWFtID0gbnVsbDtcclxuXHR0aGlzLm1lZGlhUmVjb3JkZXIgPSBudWxsO1xyXG5cdHRoaXMuY2h1bmtzID0gW107XHJcblxyXG59XHJcblxyXG5DQ1N0cmVhbUVuY29kZXIucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZSggQ0NGcmFtZUVuY29kZXIucHJvdG90eXBlICk7XHJcblxyXG5DQ1N0cmVhbUVuY29kZXIucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKCBjYW52YXMgKSB7XHJcblxyXG5cdGlmKCAhdGhpcy5zdHJlYW0gKSB7XHJcblx0XHR0aGlzLnN0cmVhbSA9IGNhbnZhcy5jYXB0dXJlU3RyZWFtKCB0aGlzLmZyYW1lcmF0ZSApO1xyXG5cdFx0dGhpcy5tZWRpYVJlY29yZGVyID0gbmV3IE1lZGlhUmVjb3JkZXIoIHRoaXMuc3RyZWFtICk7XHJcblx0XHR0aGlzLm1lZGlhUmVjb3JkZXIuc3RhcnQoKTtcclxuXHJcblx0XHR0aGlzLm1lZGlhUmVjb3JkZXIub25kYXRhYXZhaWxhYmxlID0gZnVuY3Rpb24oZSkge1xyXG5cdFx0XHR0aGlzLmNodW5rcy5wdXNoKGUuZGF0YSk7XHJcblx0XHR9LmJpbmQoIHRoaXMgKTtcclxuXHJcblx0fVxyXG5cdHRoaXMuc3RlcCgpO1xyXG5cclxufVxyXG5cclxuQ0NTdHJlYW1FbmNvZGVyLnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oIGNhbGxiYWNrICkge1xyXG5cclxuXHR0aGlzLm1lZGlhUmVjb3JkZXIub25zdG9wID0gZnVuY3Rpb24oIGUgKSB7XHJcblx0XHR2YXIgYmxvYiA9IG5ldyBCbG9iKCB0aGlzLmNodW5rcywgeyAndHlwZScgOiAndmlkZW8vd2VibScgfSk7XHJcblx0XHR0aGlzLmNodW5rcyA9IFtdO1xyXG5cdFx0Y2FsbGJhY2soIGJsb2IgKTtcclxuXHJcblx0fS5iaW5kKCB0aGlzICk7XHJcblxyXG5cdHRoaXMubWVkaWFSZWNvcmRlci5zdG9wKCk7XHJcblxyXG59XHJcblxyXG4vKmZ1bmN0aW9uIENDR0lGRW5jb2Rlciggc2V0dGluZ3MgKSB7XHJcblxyXG5cdENDRnJhbWVFbmNvZGVyLmNhbGwoIHRoaXMgKTtcclxuXHJcblx0c2V0dGluZ3MucXVhbGl0eSA9IHNldHRpbmdzLnF1YWxpdHkgfHwgNjtcclxuXHR0aGlzLnNldHRpbmdzID0gc2V0dGluZ3M7XHJcblxyXG5cdHRoaXMuZW5jb2RlciA9IG5ldyBHSUZFbmNvZGVyKCk7XHJcblx0dGhpcy5lbmNvZGVyLnNldFJlcGVhdCggMSApO1xyXG4gIFx0dGhpcy5lbmNvZGVyLnNldERlbGF5KCBzZXR0aW5ncy5zdGVwICk7XHJcbiAgXHR0aGlzLmVuY29kZXIuc2V0UXVhbGl0eSggNiApO1xyXG4gIFx0dGhpcy5lbmNvZGVyLnNldFRyYW5zcGFyZW50KCBudWxsICk7XHJcbiAgXHR0aGlzLmVuY29kZXIuc2V0U2l6ZSggMTUwLCAxNTAgKTtcclxuXHJcbiAgXHR0aGlzLmNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoICdjYW52YXMnICk7XHJcbiAgXHR0aGlzLmN0eCA9IHRoaXMuY2FudmFzLmdldENvbnRleHQoICcyZCcgKTtcclxuXHJcbn1cclxuXHJcbkNDR0lGRW5jb2Rlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKCBDQ0ZyYW1lRW5jb2RlciApO1xyXG5cclxuQ0NHSUZFbmNvZGVyLnByb3RvdHlwZS5zdGFydCA9IGZ1bmN0aW9uKCkge1xyXG5cclxuXHR0aGlzLmVuY29kZXIuc3RhcnQoKTtcclxuXHJcbn1cclxuXHJcbkNDR0lGRW5jb2Rlci5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24oIGNhbnZhcyApIHtcclxuXHJcblx0dGhpcy5jYW52YXMud2lkdGggPSBjYW52YXMud2lkdGg7XHJcblx0dGhpcy5jYW52YXMuaGVpZ2h0ID0gY2FudmFzLmhlaWdodDtcclxuXHR0aGlzLmN0eC5kcmF3SW1hZ2UoIGNhbnZhcywgMCwgMCApO1xyXG5cdHRoaXMuZW5jb2Rlci5hZGRGcmFtZSggdGhpcy5jdHggKTtcclxuXHJcblx0dGhpcy5lbmNvZGVyLnNldFNpemUoIGNhbnZhcy53aWR0aCwgY2FudmFzLmhlaWdodCApO1xyXG5cdHZhciByZWFkQnVmZmVyID0gbmV3IFVpbnQ4QXJyYXkoY2FudmFzLndpZHRoICogY2FudmFzLmhlaWdodCAqIDQpO1xyXG5cdHZhciBjb250ZXh0ID0gY2FudmFzLmdldENvbnRleHQoICd3ZWJnbCcgKTtcclxuXHRjb250ZXh0LnJlYWRQaXhlbHMoMCwgMCwgY2FudmFzLndpZHRoLCBjYW52YXMuaGVpZ2h0LCBjb250ZXh0LlJHQkEsIGNvbnRleHQuVU5TSUdORURfQllURSwgcmVhZEJ1ZmZlcik7XHJcblx0dGhpcy5lbmNvZGVyLmFkZEZyYW1lKCByZWFkQnVmZmVyLCB0cnVlICk7XHJcblxyXG59XHJcblxyXG5DQ0dJRkVuY29kZXIucHJvdG90eXBlLnN0b3AgPSBmdW5jdGlvbigpIHtcclxuXHJcblx0dGhpcy5lbmNvZGVyLmZpbmlzaCgpO1xyXG5cclxufVxyXG5cclxuQ0NHSUZFbmNvZGVyLnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oIGNhbGxiYWNrICkge1xyXG5cclxuXHR2YXIgYmluYXJ5X2dpZiA9IHRoaXMuZW5jb2Rlci5zdHJlYW0oKS5nZXREYXRhKCk7XHJcblxyXG5cdHZhciBkYXRhX3VybCA9ICdkYXRhOmltYWdlL2dpZjtiYXNlNjQsJytlbmNvZGU2NChiaW5hcnlfZ2lmKTtcclxuXHR3aW5kb3cubG9jYXRpb24gPSBkYXRhX3VybDtcclxuXHRyZXR1cm47XHJcblxyXG5cdHZhciBibG9iID0gbmV3IEJsb2IoIFsgYmluYXJ5X2dpZiBdLCB7IHR5cGU6IFwib2N0ZXQvc3RyZWFtXCIgfSApO1xyXG5cdHZhciB1cmwgPSB3aW5kb3cuVVJMLmNyZWF0ZU9iamVjdFVSTCggYmxvYiApO1xyXG5cdGNhbGxiYWNrKCB1cmwgKTtcclxuXHJcbn0qL1xyXG5cclxuZnVuY3Rpb24gQ0NHSUZFbmNvZGVyKCBzZXR0aW5ncyApIHtcclxuXHJcblx0Q0NGcmFtZUVuY29kZXIuY2FsbCggdGhpcywgc2V0dGluZ3MgKTtcclxuXHJcblx0c2V0dGluZ3MucXVhbGl0eSA9IDMxIC0gKCAoIHNldHRpbmdzLnF1YWxpdHkgKiAzMCAvIDEwMCApIHx8IDEwICk7XHJcblx0c2V0dGluZ3Mud29ya2VycyA9IHNldHRpbmdzLndvcmtlcnMgfHwgNDtcclxuXHJcblx0dGhpcy5leHRlbnNpb24gPSAnLmdpZidcclxuXHR0aGlzLm1pbWVUeXBlID0gJ2ltYWdlL2dpZidcclxuXHJcbiAgXHR0aGlzLmNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoICdjYW52YXMnICk7XHJcbiAgXHR0aGlzLmN0eCA9IHRoaXMuY2FudmFzLmdldENvbnRleHQoICcyZCcgKTtcclxuICBcdHRoaXMuc2l6ZVNldCA9IGZhbHNlO1xyXG5cclxuICBcdHRoaXMuZW5jb2RlciA9IG5ldyBHSUYoe1xyXG5cdFx0d29ya2Vyczogc2V0dGluZ3Mud29ya2VycyxcclxuXHRcdHF1YWxpdHk6IHNldHRpbmdzLnF1YWxpdHksXHJcblx0XHR3b3JrZXJTY3JpcHQ6IHNldHRpbmdzLndvcmtlcnNQYXRoICsgJ2dpZi53b3JrZXIuanMnXHJcblx0fSApO1xyXG5cclxuICAgIHRoaXMuZW5jb2Rlci5vbiggJ3Byb2dyZXNzJywgZnVuY3Rpb24oIHByb2dyZXNzICkge1xyXG4gICAgICAgIGlmICggdGhpcy5zZXR0aW5ncy5vblByb2dyZXNzICkge1xyXG4gICAgICAgICAgICB0aGlzLnNldHRpbmdzLm9uUHJvZ3Jlc3MoIHByb2dyZXNzIClcclxuICAgICAgICB9XHJcbiAgICB9LmJpbmQoIHRoaXMgKSApO1xyXG5cclxuICAgIHRoaXMuZW5jb2Rlci5vbignZmluaXNoZWQnLCBmdW5jdGlvbiggYmxvYiApIHtcclxuICAgICAgICB2YXIgY2IgPSB0aGlzLmNhbGxiYWNrO1xyXG4gICAgICAgIGlmICggY2IgKSB7XHJcbiAgICAgICAgICAgIHRoaXMuY2FsbGJhY2sgPSB1bmRlZmluZWQ7XHJcbiAgICAgICAgICAgIGNiKCBibG9iICk7XHJcbiAgICAgICAgfVxyXG4gICAgfS5iaW5kKCB0aGlzICkgKTtcclxuXHJcbn1cclxuXHJcbkNDR0lGRW5jb2Rlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKCBDQ0ZyYW1lRW5jb2Rlci5wcm90b3R5cGUgKTtcclxuXHJcbkNDR0lGRW5jb2Rlci5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24oIGNhbnZhcyApIHtcclxuXHJcblx0aWYoICF0aGlzLnNpemVTZXQgKSB7XHJcblx0XHR0aGlzLmVuY29kZXIuc2V0T3B0aW9uKCAnd2lkdGgnLGNhbnZhcy53aWR0aCApO1xyXG5cdFx0dGhpcy5lbmNvZGVyLnNldE9wdGlvbiggJ2hlaWdodCcsY2FudmFzLmhlaWdodCApO1xyXG5cdFx0dGhpcy5zaXplU2V0ID0gdHJ1ZTtcclxuXHR9XHJcblxyXG5cdHRoaXMuY2FudmFzLndpZHRoID0gY2FudmFzLndpZHRoO1xyXG5cdHRoaXMuY2FudmFzLmhlaWdodCA9IGNhbnZhcy5oZWlnaHQ7XHJcblx0dGhpcy5jdHguZHJhd0ltYWdlKCBjYW52YXMsIDAsIDAgKTtcclxuXHJcblx0dGhpcy5lbmNvZGVyLmFkZEZyYW1lKCB0aGlzLmN0eCwgeyBjb3B5OiB0cnVlLCBkZWxheTogdGhpcy5zZXR0aW5ncy5zdGVwIH0gKTtcclxuXHR0aGlzLnN0ZXAoKTtcclxuXHJcblx0Lyp0aGlzLmVuY29kZXIuc2V0U2l6ZSggY2FudmFzLndpZHRoLCBjYW52YXMuaGVpZ2h0ICk7XHJcblx0dmFyIHJlYWRCdWZmZXIgPSBuZXcgVWludDhBcnJheShjYW52YXMud2lkdGggKiBjYW52YXMuaGVpZ2h0ICogNCk7XHJcblx0dmFyIGNvbnRleHQgPSBjYW52YXMuZ2V0Q29udGV4dCggJ3dlYmdsJyApO1xyXG5cdGNvbnRleHQucmVhZFBpeGVscygwLCAwLCBjYW52YXMud2lkdGgsIGNhbnZhcy5oZWlnaHQsIGNvbnRleHQuUkdCQSwgY29udGV4dC5VTlNJR05FRF9CWVRFLCByZWFkQnVmZmVyKTtcclxuXHR0aGlzLmVuY29kZXIuYWRkRnJhbWUoIHJlYWRCdWZmZXIsIHRydWUgKTsqL1xyXG5cclxufVxyXG5cclxuQ0NHSUZFbmNvZGVyLnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oIGNhbGxiYWNrICkge1xyXG5cclxuICAgIHRoaXMuY2FsbGJhY2sgPSBjYWxsYmFjaztcclxuXHJcblx0dGhpcy5lbmNvZGVyLnJlbmRlcigpO1xyXG5cclxufVxyXG5cclxuZnVuY3Rpb24gQ0NhcHR1cmUoIHNldHRpbmdzICkge1xyXG5cclxuXHR2YXIgX3NldHRpbmdzID0gc2V0dGluZ3MgfHwge30sXHJcblx0XHRfZGF0ZSA9IG5ldyBEYXRlKCksXHJcblx0XHRfdmVyYm9zZSxcclxuXHRcdF9kaXNwbGF5LFxyXG5cdFx0X3RpbWUsXHJcblx0XHRfc3RhcnRUaW1lLFxyXG5cdFx0X3BlcmZvcm1hbmNlVGltZSxcclxuXHRcdF9wZXJmb3JtYW5jZVN0YXJ0VGltZSxcclxuXHRcdF9zdGVwLFxyXG4gICAgICAgIF9lbmNvZGVyLFxyXG5cdFx0X3RpbWVvdXRzID0gW10sXHJcblx0XHRfaW50ZXJ2YWxzID0gW10sXHJcblx0XHRfZnJhbWVDb3VudCA9IDAsXHJcblx0XHRfaW50ZXJtZWRpYXRlRnJhbWVDb3VudCA9IDAsXHJcblx0XHRfbGFzdEZyYW1lID0gbnVsbCxcclxuXHRcdF9yZXF1ZXN0QW5pbWF0aW9uRnJhbWVDYWxsYmFja3MgPSBbXSxcclxuXHRcdF9jYXB0dXJpbmcgPSBmYWxzZSxcclxuICAgICAgICBfaGFuZGxlcnMgPSB7fTtcclxuXHJcblx0X3NldHRpbmdzLmZyYW1lcmF0ZSA9IF9zZXR0aW5ncy5mcmFtZXJhdGUgfHwgNjA7XHJcblx0X3NldHRpbmdzLm1vdGlvbkJsdXJGcmFtZXMgPSAyICogKCBfc2V0dGluZ3MubW90aW9uQmx1ckZyYW1lcyB8fCAxICk7XHJcblx0X3ZlcmJvc2UgPSBfc2V0dGluZ3MudmVyYm9zZSB8fCBmYWxzZTtcclxuXHRfZGlzcGxheSA9IF9zZXR0aW5ncy5kaXNwbGF5IHx8IGZhbHNlO1xyXG5cdF9zZXR0aW5ncy5zdGVwID0gMTAwMC4wIC8gX3NldHRpbmdzLmZyYW1lcmF0ZSA7XHJcblx0X3NldHRpbmdzLnRpbWVMaW1pdCA9IF9zZXR0aW5ncy50aW1lTGltaXQgfHwgMDtcclxuXHRfc2V0dGluZ3MuZnJhbWVMaW1pdCA9IF9zZXR0aW5ncy5mcmFtZUxpbWl0IHx8IDA7XHJcblx0X3NldHRpbmdzLnN0YXJ0VGltZSA9IF9zZXR0aW5ncy5zdGFydFRpbWUgfHwgMDtcclxuXHJcblx0dmFyIF90aW1lRGlzcGxheSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoICdkaXYnICk7XHJcblx0X3RpbWVEaXNwbGF5LnN0eWxlLnBvc2l0aW9uID0gJ2Fic29sdXRlJztcclxuXHRfdGltZURpc3BsYXkuc3R5bGUubGVmdCA9IF90aW1lRGlzcGxheS5zdHlsZS50b3AgPSAwXHJcblx0X3RpbWVEaXNwbGF5LnN0eWxlLmJhY2tncm91bmRDb2xvciA9ICdibGFjayc7XHJcblx0X3RpbWVEaXNwbGF5LnN0eWxlLmZvbnRGYW1pbHkgPSAnbW9ub3NwYWNlJ1xyXG5cdF90aW1lRGlzcGxheS5zdHlsZS5mb250U2l6ZSA9ICcxMXB4J1xyXG5cdF90aW1lRGlzcGxheS5zdHlsZS5wYWRkaW5nID0gJzVweCdcclxuXHRfdGltZURpc3BsYXkuc3R5bGUuY29sb3IgPSAncmVkJztcclxuXHRfdGltZURpc3BsYXkuc3R5bGUuekluZGV4ID0gMTAwMDAwXHJcblx0aWYoIF9zZXR0aW5ncy5kaXNwbGF5ICkgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZCggX3RpbWVEaXNwbGF5ICk7XHJcblxyXG5cdHZhciBjYW52YXNNb3Rpb25CbHVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCggJ2NhbnZhcycgKTtcclxuXHR2YXIgY3R4TW90aW9uQmx1ciA9IGNhbnZhc01vdGlvbkJsdXIuZ2V0Q29udGV4dCggJzJkJyApO1xyXG5cdHZhciBidWZmZXJNb3Rpb25CbHVyO1xyXG5cdHZhciBpbWFnZURhdGE7XHJcblxyXG5cdF9sb2coICdTdGVwIGlzIHNldCB0byAnICsgX3NldHRpbmdzLnN0ZXAgKyAnbXMnICk7XHJcblxyXG4gICAgdmFyIF9lbmNvZGVycyA9IHtcclxuXHRcdGdpZjogQ0NHSUZFbmNvZGVyLFxyXG5cdFx0d2VibTogQ0NXZWJNRW5jb2RlcixcclxuXHRcdGZmbXBlZ3NlcnZlcjogQ0NGRk1wZWdTZXJ2ZXJFbmNvZGVyLFxyXG5cdFx0cG5nOiBDQ1BOR0VuY29kZXIsXHJcblx0XHRqcGc6IENDSlBFR0VuY29kZXIsXHJcblx0XHQnd2VibS1tZWRpYXJlY29yZGVyJzogQ0NTdHJlYW1FbmNvZGVyXHJcbiAgICB9O1xyXG5cclxuICAgIHZhciBjdG9yID0gX2VuY29kZXJzWyBfc2V0dGluZ3MuZm9ybWF0IF07XHJcbiAgICBpZiAoICFjdG9yICkge1xyXG5cdFx0dGhyb3cgXCJFcnJvcjogSW5jb3JyZWN0IG9yIG1pc3NpbmcgZm9ybWF0OiBWYWxpZCBmb3JtYXRzIGFyZSBcIiArIE9iamVjdC5rZXlzKF9lbmNvZGVycykuam9pbihcIiwgXCIpO1xyXG4gICAgfVxyXG4gICAgX2VuY29kZXIgPSBuZXcgY3RvciggX3NldHRpbmdzICk7XHJcbiAgICBfZW5jb2Rlci5zdGVwID0gX3N0ZXBcclxuXHJcblx0X2VuY29kZXIub24oJ3Byb2Nlc3MnLCBfcHJvY2Vzcyk7XHJcbiAgICBfZW5jb2Rlci5vbigncHJvZ3Jlc3MnLCBfcHJvZ3Jlc3MpO1xyXG5cclxuICAgIGlmIChcInBlcmZvcm1hbmNlXCIgaW4gd2luZG93ID09IGZhbHNlKSB7XHJcbiAgICBcdHdpbmRvdy5wZXJmb3JtYW5jZSA9IHt9O1xyXG4gICAgfVxyXG5cclxuXHREYXRlLm5vdyA9IChEYXRlLm5vdyB8fCBmdW5jdGlvbiAoKSB7ICAvLyB0aGFua3MgSUU4XHJcblx0XHRyZXR1cm4gbmV3IERhdGUoKS5nZXRUaW1lKCk7XHJcblx0fSk7XHJcblxyXG5cdGlmIChcIm5vd1wiIGluIHdpbmRvdy5wZXJmb3JtYW5jZSA9PSBmYWxzZSl7XHJcblxyXG5cdFx0dmFyIG5vd09mZnNldCA9IERhdGUubm93KCk7XHJcblxyXG5cdFx0aWYgKHBlcmZvcm1hbmNlLnRpbWluZyAmJiBwZXJmb3JtYW5jZS50aW1pbmcubmF2aWdhdGlvblN0YXJ0KXtcclxuXHRcdFx0bm93T2Zmc2V0ID0gcGVyZm9ybWFuY2UudGltaW5nLm5hdmlnYXRpb25TdGFydFxyXG5cdFx0fVxyXG5cclxuXHRcdHdpbmRvdy5wZXJmb3JtYW5jZS5ub3cgPSBmdW5jdGlvbiBub3coKXtcclxuXHRcdFx0cmV0dXJuIERhdGUubm93KCkgLSBub3dPZmZzZXQ7XHJcblx0XHR9XHJcblx0fVxyXG5cclxuXHR2YXIgX29sZFNldFRpbWVvdXQgPSB3aW5kb3cuc2V0VGltZW91dCxcclxuXHRcdF9vbGRTZXRJbnRlcnZhbCA9IHdpbmRvdy5zZXRJbnRlcnZhbCxcclxuXHQgICAgXHRfb2xkQ2xlYXJJbnRlcnZhbCA9IHdpbmRvdy5jbGVhckludGVydmFsLFxyXG5cdFx0X29sZENsZWFyVGltZW91dCA9IHdpbmRvdy5jbGVhclRpbWVvdXQsXHJcblx0XHRfb2xkUmVxdWVzdEFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSxcclxuXHRcdF9vbGROb3cgPSB3aW5kb3cuRGF0ZS5ub3csXHJcblx0XHRfb2xkUGVyZm9ybWFuY2VOb3cgPSB3aW5kb3cucGVyZm9ybWFuY2Uubm93LFxyXG5cdFx0X29sZEdldFRpbWUgPSB3aW5kb3cuRGF0ZS5wcm90b3R5cGUuZ2V0VGltZTtcclxuXHQvLyBEYXRlLnByb3RvdHlwZS5fb2xkR2V0VGltZSA9IERhdGUucHJvdG90eXBlLmdldFRpbWU7XHJcblxyXG5cdHZhciBtZWRpYSA9IFtdO1xyXG5cclxuXHRmdW5jdGlvbiBfaW5pdCgpIHtcclxuXHJcblx0XHRfbG9nKCAnQ2FwdHVyZXIgc3RhcnQnICk7XHJcblxyXG5cdFx0X3N0YXJ0VGltZSA9IHdpbmRvdy5EYXRlLm5vdygpO1xyXG5cdFx0X3RpbWUgPSBfc3RhcnRUaW1lICsgX3NldHRpbmdzLnN0YXJ0VGltZTtcclxuXHRcdF9wZXJmb3JtYW5jZVN0YXJ0VGltZSA9IHdpbmRvdy5wZXJmb3JtYW5jZS5ub3coKTtcclxuXHRcdF9wZXJmb3JtYW5jZVRpbWUgPSBfcGVyZm9ybWFuY2VTdGFydFRpbWUgKyBfc2V0dGluZ3Muc3RhcnRUaW1lO1xyXG5cclxuXHRcdHdpbmRvdy5EYXRlLnByb3RvdHlwZS5nZXRUaW1lID0gZnVuY3Rpb24oKXtcclxuXHRcdFx0cmV0dXJuIF90aW1lO1xyXG5cdFx0fTtcclxuXHRcdHdpbmRvdy5EYXRlLm5vdyA9IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRyZXR1cm4gX3RpbWU7XHJcblx0XHR9O1xyXG5cclxuXHRcdHdpbmRvdy5zZXRUaW1lb3V0ID0gZnVuY3Rpb24oIGNhbGxiYWNrLCB0aW1lICkge1xyXG5cdFx0XHR2YXIgdCA9IHtcclxuXHRcdFx0XHRjYWxsYmFjazogY2FsbGJhY2ssXHJcblx0XHRcdFx0dGltZTogdGltZSxcclxuXHRcdFx0XHR0cmlnZ2VyVGltZTogX3RpbWUgKyB0aW1lXHJcblx0XHRcdH07XHJcblx0XHRcdF90aW1lb3V0cy5wdXNoKCB0ICk7XHJcblx0XHRcdF9sb2coICdUaW1lb3V0IHNldCB0byAnICsgdC50aW1lICk7XHJcbiAgICAgICAgICAgIHJldHVybiB0O1xyXG5cdFx0fTtcclxuXHRcdHdpbmRvdy5jbGVhclRpbWVvdXQgPSBmdW5jdGlvbiggaWQgKSB7XHJcblx0XHRcdGZvciggdmFyIGogPSAwOyBqIDwgX3RpbWVvdXRzLmxlbmd0aDsgaisrICkge1xyXG5cdFx0XHRcdGlmKCBfdGltZW91dHNbIGogXSA9PSBpZCApIHtcclxuXHRcdFx0XHRcdF90aW1lb3V0cy5zcGxpY2UoIGosIDEgKTtcclxuXHRcdFx0XHRcdF9sb2coICdUaW1lb3V0IGNsZWFyZWQnICk7XHJcblx0XHRcdFx0XHRjb250aW51ZTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdH07XHJcblx0XHR3aW5kb3cuc2V0SW50ZXJ2YWwgPSBmdW5jdGlvbiggY2FsbGJhY2ssIHRpbWUgKSB7XHJcblx0XHRcdHZhciB0ID0ge1xyXG5cdFx0XHRcdGNhbGxiYWNrOiBjYWxsYmFjayxcclxuXHRcdFx0XHR0aW1lOiB0aW1lLFxyXG5cdFx0XHRcdHRyaWdnZXJUaW1lOiBfdGltZSArIHRpbWVcclxuXHRcdFx0fTtcclxuXHRcdFx0X2ludGVydmFscy5wdXNoKCB0ICk7XHJcblx0XHRcdF9sb2coICdJbnRlcnZhbCBzZXQgdG8gJyArIHQudGltZSApO1xyXG5cdFx0XHRyZXR1cm4gdDtcclxuXHRcdH07XHJcblx0XHR3aW5kb3cuY2xlYXJJbnRlcnZhbCA9IGZ1bmN0aW9uKCBpZCApIHtcclxuXHRcdFx0X2xvZyggJ2NsZWFyIEludGVydmFsJyApO1xyXG5cdFx0XHRyZXR1cm4gbnVsbDtcclxuXHRcdH07XHJcblx0XHR3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lID0gZnVuY3Rpb24oIGNhbGxiYWNrICkge1xyXG5cdFx0XHRfcmVxdWVzdEFuaW1hdGlvbkZyYW1lQ2FsbGJhY2tzLnB1c2goIGNhbGxiYWNrICk7XHJcblx0XHR9O1xyXG5cdFx0d2luZG93LnBlcmZvcm1hbmNlLm5vdyA9IGZ1bmN0aW9uKCl7XHJcblx0XHRcdHJldHVybiBfcGVyZm9ybWFuY2VUaW1lO1xyXG5cdFx0fTtcclxuXHJcblx0XHRmdW5jdGlvbiBob29rQ3VycmVudFRpbWUoKSB7XHJcblx0XHRcdGlmKCAhdGhpcy5faG9va2VkICkge1xyXG5cdFx0XHRcdHRoaXMuX2hvb2tlZCA9IHRydWU7XHJcblx0XHRcdFx0dGhpcy5faG9va2VkVGltZSA9IHRoaXMuY3VycmVudFRpbWUgfHwgMDtcclxuXHRcdFx0XHR0aGlzLnBhdXNlKCk7XHJcblx0XHRcdFx0bWVkaWEucHVzaCggdGhpcyApO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiB0aGlzLl9ob29rZWRUaW1lICsgX3NldHRpbmdzLnN0YXJ0VGltZTtcclxuXHRcdH07XHJcblxyXG5cdFx0dHJ5IHtcclxuXHRcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KCBIVE1MVmlkZW9FbGVtZW50LnByb3RvdHlwZSwgJ2N1cnJlbnRUaW1lJywgeyBnZXQ6IGhvb2tDdXJyZW50VGltZSB9IClcclxuXHRcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KCBIVE1MQXVkaW9FbGVtZW50LnByb3RvdHlwZSwgJ2N1cnJlbnRUaW1lJywgeyBnZXQ6IGhvb2tDdXJyZW50VGltZSB9IClcclxuXHRcdH0gY2F0Y2ggKGVycikge1xyXG5cdFx0XHRfbG9nKGVycik7XHJcblx0XHR9XHJcblxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gX3N0YXJ0KCkge1xyXG5cdFx0X2luaXQoKTtcclxuXHRcdF9lbmNvZGVyLnN0YXJ0KCk7XHJcblx0XHRfY2FwdHVyaW5nID0gdHJ1ZTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIF9zdG9wKCkge1xyXG5cdFx0X2NhcHR1cmluZyA9IGZhbHNlO1xyXG5cdFx0X2VuY29kZXIuc3RvcCgpO1xyXG5cdFx0X2Rlc3Ryb3koKTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIF9jYWxsKCBmbiwgcCApIHtcclxuXHRcdF9vbGRTZXRUaW1lb3V0KCBmbiwgMCwgcCApO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gX3N0ZXAoKSB7XHJcblx0XHQvL19vbGRSZXF1ZXN0QW5pbWF0aW9uRnJhbWUoIF9wcm9jZXNzICk7XHJcblx0XHRfY2FsbCggX3Byb2Nlc3MgKTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIF9kZXN0cm95KCkge1xyXG5cdFx0X2xvZyggJ0NhcHR1cmVyIHN0b3AnICk7XHJcblx0XHR3aW5kb3cuc2V0VGltZW91dCA9IF9vbGRTZXRUaW1lb3V0O1xyXG5cdFx0d2luZG93LnNldEludGVydmFsID0gX29sZFNldEludGVydmFsO1xyXG5cdFx0d2luZG93LmNsZWFySW50ZXJ2YWwgPSBfb2xkQ2xlYXJJbnRlcnZhbDtcclxuXHRcdHdpbmRvdy5jbGVhclRpbWVvdXQgPSBfb2xkQ2xlYXJUaW1lb3V0O1xyXG5cdFx0d2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSA9IF9vbGRSZXF1ZXN0QW5pbWF0aW9uRnJhbWU7XHJcblx0XHR3aW5kb3cuRGF0ZS5wcm90b3R5cGUuZ2V0VGltZSA9IF9vbGRHZXRUaW1lO1xyXG5cdFx0d2luZG93LkRhdGUubm93ID0gX29sZE5vdztcclxuXHRcdHdpbmRvdy5wZXJmb3JtYW5jZS5ub3cgPSBfb2xkUGVyZm9ybWFuY2VOb3c7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBfdXBkYXRlVGltZSgpIHtcclxuXHRcdHZhciBzZWNvbmRzID0gX2ZyYW1lQ291bnQgLyBfc2V0dGluZ3MuZnJhbWVyYXRlO1xyXG5cdFx0aWYoICggX3NldHRpbmdzLmZyYW1lTGltaXQgJiYgX2ZyYW1lQ291bnQgPj0gX3NldHRpbmdzLmZyYW1lTGltaXQgKSB8fCAoIF9zZXR0aW5ncy50aW1lTGltaXQgJiYgc2Vjb25kcyA+PSBfc2V0dGluZ3MudGltZUxpbWl0ICkgKSB7XHJcblx0XHRcdF9zdG9wKCk7XHJcblx0XHRcdF9zYXZlKCk7XHJcblx0XHR9XHJcblx0XHR2YXIgZCA9IG5ldyBEYXRlKCBudWxsICk7XHJcblx0XHRkLnNldFNlY29uZHMoIHNlY29uZHMgKTtcclxuXHRcdGlmKCBfc2V0dGluZ3MubW90aW9uQmx1ckZyYW1lcyA+IDIgKSB7XHJcblx0XHRcdF90aW1lRGlzcGxheS50ZXh0Q29udGVudCA9ICdDQ2FwdHVyZSAnICsgX3NldHRpbmdzLmZvcm1hdCArICcgfCAnICsgX2ZyYW1lQ291bnQgKyAnIGZyYW1lcyAoJyArIF9pbnRlcm1lZGlhdGVGcmFtZUNvdW50ICsgJyBpbnRlcikgfCAnICsgIGQudG9JU09TdHJpbmcoKS5zdWJzdHIoIDExLCA4ICk7XHJcblx0XHR9IGVsc2Uge1xyXG5cdFx0XHRfdGltZURpc3BsYXkudGV4dENvbnRlbnQgPSAnQ0NhcHR1cmUgJyArIF9zZXR0aW5ncy5mb3JtYXQgKyAnIHwgJyArIF9mcmFtZUNvdW50ICsgJyBmcmFtZXMgfCAnICsgIGQudG9JU09TdHJpbmcoKS5zdWJzdHIoIDExLCA4ICk7XHJcblx0XHR9XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBfY2hlY2tGcmFtZSggY2FudmFzICkge1xyXG5cclxuXHRcdGlmKCBjYW52YXNNb3Rpb25CbHVyLndpZHRoICE9PSBjYW52YXMud2lkdGggfHwgY2FudmFzTW90aW9uQmx1ci5oZWlnaHQgIT09IGNhbnZhcy5oZWlnaHQgKSB7XHJcblx0XHRcdGNhbnZhc01vdGlvbkJsdXIud2lkdGggPSBjYW52YXMud2lkdGg7XHJcblx0XHRcdGNhbnZhc01vdGlvbkJsdXIuaGVpZ2h0ID0gY2FudmFzLmhlaWdodDtcclxuXHRcdFx0YnVmZmVyTW90aW9uQmx1ciA9IG5ldyBVaW50MTZBcnJheSggY2FudmFzTW90aW9uQmx1ci5oZWlnaHQgKiBjYW52YXNNb3Rpb25CbHVyLndpZHRoICogNCApO1xyXG5cdFx0XHRjdHhNb3Rpb25CbHVyLmZpbGxTdHlsZSA9ICcjMCdcclxuXHRcdFx0Y3R4TW90aW9uQmx1ci5maWxsUmVjdCggMCwgMCwgY2FudmFzTW90aW9uQmx1ci53aWR0aCwgY2FudmFzTW90aW9uQmx1ci5oZWlnaHQgKTtcclxuXHRcdH1cclxuXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBfYmxlbmRGcmFtZSggY2FudmFzICkge1xyXG5cclxuXHRcdC8vX2xvZyggJ0ludGVybWVkaWF0ZSBGcmFtZTogJyArIF9pbnRlcm1lZGlhdGVGcmFtZUNvdW50ICk7XHJcblxyXG5cdFx0Y3R4TW90aW9uQmx1ci5kcmF3SW1hZ2UoIGNhbnZhcywgMCwgMCApO1xyXG5cdFx0aW1hZ2VEYXRhID0gY3R4TW90aW9uQmx1ci5nZXRJbWFnZURhdGEoIDAsIDAsIGNhbnZhc01vdGlvbkJsdXIud2lkdGgsIGNhbnZhc01vdGlvbkJsdXIuaGVpZ2h0ICk7XHJcblx0XHRmb3IoIHZhciBqID0gMDsgaiA8IGJ1ZmZlck1vdGlvbkJsdXIubGVuZ3RoOyBqKz0gNCApIHtcclxuXHRcdFx0YnVmZmVyTW90aW9uQmx1clsgaiBdICs9IGltYWdlRGF0YS5kYXRhWyBqIF07XHJcblx0XHRcdGJ1ZmZlck1vdGlvbkJsdXJbIGogKyAxIF0gKz0gaW1hZ2VEYXRhLmRhdGFbIGogKyAxIF07XHJcblx0XHRcdGJ1ZmZlck1vdGlvbkJsdXJbIGogKyAyIF0gKz0gaW1hZ2VEYXRhLmRhdGFbIGogKyAyIF07XHJcblx0XHR9XHJcblx0XHRfaW50ZXJtZWRpYXRlRnJhbWVDb3VudCsrO1xyXG5cclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIF9zYXZlRnJhbWUoKXtcclxuXHJcblx0XHR2YXIgZGF0YSA9IGltYWdlRGF0YS5kYXRhO1xyXG5cdFx0Zm9yKCB2YXIgaiA9IDA7IGogPCBidWZmZXJNb3Rpb25CbHVyLmxlbmd0aDsgais9IDQgKSB7XHJcblx0XHRcdGRhdGFbIGogXSA9IGJ1ZmZlck1vdGlvbkJsdXJbIGogXSAqIDIgLyBfc2V0dGluZ3MubW90aW9uQmx1ckZyYW1lcztcclxuXHRcdFx0ZGF0YVsgaiArIDEgXSA9IGJ1ZmZlck1vdGlvbkJsdXJbIGogKyAxIF0gKiAyIC8gX3NldHRpbmdzLm1vdGlvbkJsdXJGcmFtZXM7XHJcblx0XHRcdGRhdGFbIGogKyAyIF0gPSBidWZmZXJNb3Rpb25CbHVyWyBqICsgMiBdICogMiAvIF9zZXR0aW5ncy5tb3Rpb25CbHVyRnJhbWVzO1xyXG5cdFx0fVxyXG5cdFx0Y3R4TW90aW9uQmx1ci5wdXRJbWFnZURhdGEoIGltYWdlRGF0YSwgMCwgMCApO1xyXG5cdFx0X2VuY29kZXIuYWRkKCBjYW52YXNNb3Rpb25CbHVyICk7XHJcblx0XHRfZnJhbWVDb3VudCsrO1xyXG5cdFx0X2ludGVybWVkaWF0ZUZyYW1lQ291bnQgPSAwO1xyXG5cdFx0X2xvZyggJ0Z1bGwgTUIgRnJhbWUhICcgKyBfZnJhbWVDb3VudCArICcgJyArICBfdGltZSApO1xyXG5cdFx0Zm9yKCB2YXIgaiA9IDA7IGogPCBidWZmZXJNb3Rpb25CbHVyLmxlbmd0aDsgais9IDQgKSB7XHJcblx0XHRcdGJ1ZmZlck1vdGlvbkJsdXJbIGogXSA9IDA7XHJcblx0XHRcdGJ1ZmZlck1vdGlvbkJsdXJbIGogKyAxIF0gPSAwO1xyXG5cdFx0XHRidWZmZXJNb3Rpb25CbHVyWyBqICsgMiBdID0gMDtcclxuXHRcdH1cclxuXHRcdGdjKCk7XHJcblxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gX2NhcHR1cmUoIGNhbnZhcyApIHtcclxuXHJcblx0XHRpZiggX2NhcHR1cmluZyApIHtcclxuXHJcblx0XHRcdGlmKCBfc2V0dGluZ3MubW90aW9uQmx1ckZyYW1lcyA+IDIgKSB7XHJcblxyXG5cdFx0XHRcdF9jaGVja0ZyYW1lKCBjYW52YXMgKTtcclxuXHRcdFx0XHRfYmxlbmRGcmFtZSggY2FudmFzICk7XHJcblxyXG5cdFx0XHRcdGlmKCBfaW50ZXJtZWRpYXRlRnJhbWVDb3VudCA+PSAuNSAqIF9zZXR0aW5ncy5tb3Rpb25CbHVyRnJhbWVzICkge1xyXG5cdFx0XHRcdFx0X3NhdmVGcmFtZSgpO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRfc3RlcCgpO1xyXG5cdFx0XHRcdH1cclxuXHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0X2VuY29kZXIuYWRkKCBjYW52YXMgKTtcclxuXHRcdFx0XHRfZnJhbWVDb3VudCsrO1xyXG5cdFx0XHRcdF9sb2coICdGdWxsIEZyYW1lISAnICsgX2ZyYW1lQ291bnQgKTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdH1cclxuXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBfcHJvY2VzcygpIHtcclxuXHJcblx0XHR2YXIgc3RlcCA9IDEwMDAgLyBfc2V0dGluZ3MuZnJhbWVyYXRlO1xyXG5cdFx0dmFyIGR0ID0gKCBfZnJhbWVDb3VudCArIF9pbnRlcm1lZGlhdGVGcmFtZUNvdW50IC8gX3NldHRpbmdzLm1vdGlvbkJsdXJGcmFtZXMgKSAqIHN0ZXA7XHJcblxyXG5cdFx0X3RpbWUgPSBfc3RhcnRUaW1lICsgZHQ7XHJcblx0XHRfcGVyZm9ybWFuY2VUaW1lID0gX3BlcmZvcm1hbmNlU3RhcnRUaW1lICsgZHQ7XHJcblxyXG5cdFx0bWVkaWEuZm9yRWFjaCggZnVuY3Rpb24oIHYgKSB7XHJcblx0XHRcdHYuX2hvb2tlZFRpbWUgPSBkdCAvIDEwMDA7XHJcblx0XHR9ICk7XHJcblxyXG5cdFx0X3VwZGF0ZVRpbWUoKTtcclxuXHRcdF9sb2coICdGcmFtZTogJyArIF9mcmFtZUNvdW50ICsgJyAnICsgX2ludGVybWVkaWF0ZUZyYW1lQ291bnQgKTtcclxuXHJcblx0XHRmb3IoIHZhciBqID0gMDsgaiA8IF90aW1lb3V0cy5sZW5ndGg7IGorKyApIHtcclxuXHRcdFx0aWYoIF90aW1lID49IF90aW1lb3V0c1sgaiBdLnRyaWdnZXJUaW1lICkge1xyXG5cdFx0XHRcdF9jYWxsKCBfdGltZW91dHNbIGogXS5jYWxsYmFjayApXHJcblx0XHRcdFx0Ly9jb25zb2xlLmxvZyggJ3RpbWVvdXQhJyApO1xyXG5cdFx0XHRcdF90aW1lb3V0cy5zcGxpY2UoIGosIDEgKTtcclxuXHRcdFx0XHRjb250aW51ZTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cclxuXHRcdGZvciggdmFyIGogPSAwOyBqIDwgX2ludGVydmFscy5sZW5ndGg7IGorKyApIHtcclxuXHRcdFx0aWYoIF90aW1lID49IF9pbnRlcnZhbHNbIGogXS50cmlnZ2VyVGltZSApIHtcclxuXHRcdFx0XHRfY2FsbCggX2ludGVydmFsc1sgaiBdLmNhbGxiYWNrICk7XHJcblx0XHRcdFx0X2ludGVydmFsc1sgaiBdLnRyaWdnZXJUaW1lICs9IF9pbnRlcnZhbHNbIGogXS50aW1lO1xyXG5cdFx0XHRcdC8vY29uc29sZS5sb2coICdpbnRlcnZhbCEnICk7XHJcblx0XHRcdFx0Y29udGludWU7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHJcblx0XHRfcmVxdWVzdEFuaW1hdGlvbkZyYW1lQ2FsbGJhY2tzLmZvckVhY2goIGZ1bmN0aW9uKCBjYiApIHtcclxuICAgICBcdFx0X2NhbGwoIGNiLCBfdGltZSAtIGdfc3RhcnRUaW1lICk7XHJcbiAgICAgICAgfSApO1xyXG4gICAgICAgIF9yZXF1ZXN0QW5pbWF0aW9uRnJhbWVDYWxsYmFja3MgPSBbXTtcclxuXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBfc2F2ZSggY2FsbGJhY2sgKSB7XHJcblxyXG5cdFx0aWYoICFjYWxsYmFjayApIHtcclxuXHRcdFx0Y2FsbGJhY2sgPSBmdW5jdGlvbiggYmxvYiApIHtcclxuXHRcdFx0XHRkb3dubG9hZCggYmxvYiwgX2VuY29kZXIuZmlsZW5hbWUgKyBfZW5jb2Rlci5leHRlbnNpb24sIF9lbmNvZGVyLm1pbWVUeXBlICk7XHJcblx0XHRcdFx0cmV0dXJuIGZhbHNlO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRfZW5jb2Rlci5zYXZlKCBjYWxsYmFjayApO1xyXG5cclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIF9sb2coIG1lc3NhZ2UgKSB7XHJcblx0XHRpZiggX3ZlcmJvc2UgKSBjb25zb2xlLmxvZyggbWVzc2FnZSApO1xyXG5cdH1cclxuXHJcbiAgICBmdW5jdGlvbiBfb24oIGV2ZW50LCBoYW5kbGVyICkge1xyXG5cclxuICAgICAgICBfaGFuZGxlcnNbZXZlbnRdID0gaGFuZGxlcjtcclxuXHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gX2VtaXQoIGV2ZW50ICkge1xyXG5cclxuICAgICAgICB2YXIgaGFuZGxlciA9IF9oYW5kbGVyc1tldmVudF07XHJcbiAgICAgICAgaWYgKCBoYW5kbGVyICkge1xyXG5cclxuICAgICAgICAgICAgaGFuZGxlci5hcHBseSggbnVsbCwgQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoIGFyZ3VtZW50cywgMSApICk7XHJcblxyXG4gICAgICAgIH1cclxuXHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gX3Byb2dyZXNzKCBwcm9ncmVzcyApIHtcclxuXHJcbiAgICAgICAgX2VtaXQoICdwcm9ncmVzcycsIHByb2dyZXNzICk7XHJcblxyXG4gICAgfVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0c3RhcnQ6IF9zdGFydCxcclxuXHRcdGNhcHR1cmU6IF9jYXB0dXJlLFxyXG5cdFx0c3RvcDogX3N0b3AsXHJcblx0XHRzYXZlOiBfc2F2ZSxcclxuICAgICAgICBvbjogX29uXHJcblx0fVxyXG59XHJcblxyXG4oZnJlZVdpbmRvdyB8fCBmcmVlU2VsZiB8fCB7fSkuQ0NhcHR1cmUgPSBDQ2FwdHVyZTtcclxuXHJcbiAgLy8gU29tZSBBTUQgYnVpbGQgb3B0aW1pemVycyBsaWtlIHIuanMgY2hlY2sgZm9yIGNvbmRpdGlvbiBwYXR0ZXJucyBsaWtlIHRoZSBmb2xsb3dpbmc6XHJcbiAgaWYgKHR5cGVvZiBkZWZpbmUgPT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgZGVmaW5lLmFtZCA9PSAnb2JqZWN0JyAmJiBkZWZpbmUuYW1kKSB7XHJcbiAgICAvLyBEZWZpbmUgYXMgYW4gYW5vbnltb3VzIG1vZHVsZSBzbywgdGhyb3VnaCBwYXRoIG1hcHBpbmcsIGl0IGNhbiBiZVxyXG4gICAgLy8gcmVmZXJlbmNlZCBhcyB0aGUgXCJ1bmRlcnNjb3JlXCIgbW9kdWxlLlxyXG4gICAgZGVmaW5lKGZ1bmN0aW9uKCkge1xyXG4gICAgXHRyZXR1cm4gQ0NhcHR1cmU7XHJcbiAgICB9KTtcclxufVxyXG4gIC8vIENoZWNrIGZvciBgZXhwb3J0c2AgYWZ0ZXIgYGRlZmluZWAgaW4gY2FzZSBhIGJ1aWxkIG9wdGltaXplciBhZGRzIGFuIGBleHBvcnRzYCBvYmplY3QuXHJcbiAgZWxzZSBpZiAoZnJlZUV4cG9ydHMgJiYgZnJlZU1vZHVsZSkge1xyXG4gICAgLy8gRXhwb3J0IGZvciBOb2RlLmpzLlxyXG4gICAgaWYgKG1vZHVsZUV4cG9ydHMpIHtcclxuICAgIFx0KGZyZWVNb2R1bGUuZXhwb3J0cyA9IENDYXB0dXJlKS5DQ2FwdHVyZSA9IENDYXB0dXJlO1xyXG4gICAgfVxyXG4gICAgLy8gRXhwb3J0IGZvciBDb21tb25KUyBzdXBwb3J0LlxyXG4gICAgZnJlZUV4cG9ydHMuQ0NhcHR1cmUgPSBDQ2FwdHVyZTtcclxufVxyXG5lbHNlIHtcclxuICAgIC8vIEV4cG9ydCB0byB0aGUgZ2xvYmFsIG9iamVjdC5cclxuICAgIHJvb3QuQ0NhcHR1cmUgPSBDQ2FwdHVyZTtcclxufVxyXG5cclxufSgpKTtcclxuIiwiLyoqXG4gKiBAYXV0aG9yIGFsdGVyZWRxIC8gaHR0cDovL2FsdGVyZWRxdWFsaWEuY29tL1xuICogQGF1dGhvciBtci5kb29iIC8gaHR0cDovL21yZG9vYi5jb20vXG4gKi9cblxudmFyIERldGVjdG9yID0ge1xuXG5cdGNhbnZhczogISEgd2luZG93LkNhbnZhc1JlbmRlcmluZ0NvbnRleHQyRCxcblx0d2ViZ2w6ICggZnVuY3Rpb24gKCkge1xuXG5cdFx0dHJ5IHtcblxuXHRcdFx0dmFyIGNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoICdjYW52YXMnICk7IHJldHVybiAhISAoIHdpbmRvdy5XZWJHTFJlbmRlcmluZ0NvbnRleHQgJiYgKCBjYW52YXMuZ2V0Q29udGV4dCggJ3dlYmdsJyApIHx8IGNhbnZhcy5nZXRDb250ZXh0KCAnZXhwZXJpbWVudGFsLXdlYmdsJyApICkgKTtcblxuXHRcdH0gY2F0Y2ggKCBlICkge1xuXG5cdFx0XHRyZXR1cm4gZmFsc2U7XG5cblx0XHR9XG5cblx0fSApKCksXG5cdHdvcmtlcnM6ICEhIHdpbmRvdy5Xb3JrZXIsXG5cdGZpbGVhcGk6IHdpbmRvdy5GaWxlICYmIHdpbmRvdy5GaWxlUmVhZGVyICYmIHdpbmRvdy5GaWxlTGlzdCAmJiB3aW5kb3cuQmxvYixcblxuXHRnZXRXZWJHTEVycm9yTWVzc2FnZTogZnVuY3Rpb24gKCkge1xuXG5cdFx0dmFyIGVsZW1lbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCAnZGl2JyApO1xuXHRcdGVsZW1lbnQuaWQgPSAnd2ViZ2wtZXJyb3ItbWVzc2FnZSc7XG5cdFx0ZWxlbWVudC5zdHlsZS5mb250RmFtaWx5ID0gJ21vbm9zcGFjZSc7XG5cdFx0ZWxlbWVudC5zdHlsZS5mb250U2l6ZSA9ICcxM3B4Jztcblx0XHRlbGVtZW50LnN0eWxlLmZvbnRXZWlnaHQgPSAnbm9ybWFsJztcblx0XHRlbGVtZW50LnN0eWxlLnRleHRBbGlnbiA9ICdjZW50ZXInO1xuXHRcdGVsZW1lbnQuc3R5bGUuYmFja2dyb3VuZCA9ICcjZmZmJztcblx0XHRlbGVtZW50LnN0eWxlLmNvbG9yID0gJyMwMDAnO1xuXHRcdGVsZW1lbnQuc3R5bGUucGFkZGluZyA9ICcxLjVlbSc7XG5cdFx0ZWxlbWVudC5zdHlsZS56SW5kZXggPSAnOTk5Jztcblx0XHRlbGVtZW50LnN0eWxlLndpZHRoID0gJzQwMHB4Jztcblx0XHRlbGVtZW50LnN0eWxlLm1hcmdpbiA9ICc1ZW0gYXV0byAwJztcblxuXHRcdGlmICggISB0aGlzLndlYmdsICkge1xuXG5cdFx0XHRlbGVtZW50LmlubmVySFRNTCA9IHdpbmRvdy5XZWJHTFJlbmRlcmluZ0NvbnRleHQgPyBbXG5cdFx0XHRcdCdZb3VyIGdyYXBoaWNzIGNhcmQgZG9lcyBub3Qgc2VlbSB0byBzdXBwb3J0IDxhIGhyZWY9XCJodHRwOi8va2hyb25vcy5vcmcvd2ViZ2wvd2lraS9HZXR0aW5nX2FfV2ViR0xfSW1wbGVtZW50YXRpb25cIiBzdHlsZT1cImNvbG9yOiMwMDBcIj5XZWJHTDwvYT4uPGJyIC8+Jyxcblx0XHRcdFx0J0ZpbmQgb3V0IGhvdyB0byBnZXQgaXQgPGEgaHJlZj1cImh0dHA6Ly9nZXQud2ViZ2wub3JnL1wiIHN0eWxlPVwiY29sb3I6IzAwMFwiPmhlcmU8L2E+Lidcblx0XHRcdF0uam9pbiggJ1xcbicgKSA6IFtcblx0XHRcdFx0J1lvdXIgYnJvd3NlciBkb2VzIG5vdCBzZWVtIHRvIHN1cHBvcnQgPGEgaHJlZj1cImh0dHA6Ly9raHJvbm9zLm9yZy93ZWJnbC93aWtpL0dldHRpbmdfYV9XZWJHTF9JbXBsZW1lbnRhdGlvblwiIHN0eWxlPVwiY29sb3I6IzAwMFwiPldlYkdMPC9hPi48YnIvPicsXG5cdFx0XHRcdCdGaW5kIG91dCBob3cgdG8gZ2V0IGl0IDxhIGhyZWY9XCJodHRwOi8vZ2V0LndlYmdsLm9yZy9cIiBzdHlsZT1cImNvbG9yOiMwMDBcIj5oZXJlPC9hPi4nXG5cdFx0XHRdLmpvaW4oICdcXG4nICk7XG5cblx0XHR9XG5cblx0XHRyZXR1cm4gZWxlbWVudDtcblxuXHR9LFxuXG5cdGFkZEdldFdlYkdMTWVzc2FnZTogZnVuY3Rpb24gKCBwYXJhbWV0ZXJzICkge1xuXG5cdFx0dmFyIHBhcmVudCwgaWQsIGVsZW1lbnQ7XG5cblx0XHRwYXJhbWV0ZXJzID0gcGFyYW1ldGVycyB8fCB7fTtcblxuXHRcdHBhcmVudCA9IHBhcmFtZXRlcnMucGFyZW50ICE9PSB1bmRlZmluZWQgPyBwYXJhbWV0ZXJzLnBhcmVudCA6IGRvY3VtZW50LmJvZHk7XG5cdFx0aWQgPSBwYXJhbWV0ZXJzLmlkICE9PSB1bmRlZmluZWQgPyBwYXJhbWV0ZXJzLmlkIDogJ29sZGllJztcblxuXHRcdGVsZW1lbnQgPSBEZXRlY3Rvci5nZXRXZWJHTEVycm9yTWVzc2FnZSgpO1xuXHRcdGVsZW1lbnQuaWQgPSBpZDtcblxuXHRcdHBhcmVudC5hcHBlbmRDaGlsZCggZWxlbWVudCApO1xuXG5cdH1cblxufTtcblxuLy9FUzYgZXhwb3J0XG5cbmV4cG9ydCB7IERldGVjdG9yIH07XG4iLCIvL1RoaXMgbGlicmFyeSBpcyBkZXNpZ25lZCB0byBoZWxwIHN0YXJ0IHRocmVlLmpzIGVhc2lseSwgY3JlYXRpbmcgdGhlIHJlbmRlciBsb29wIGFuZCBjYW52YXMgYXV0b21hZ2ljYWxseS5cbi8vUmVhbGx5IGl0IHNob3VsZCBiZSBzcHVuIG9mZiBpbnRvIGl0cyBvd24gdGhpbmcgaW5zdGVhZCBvZiBiZWluZyBwYXJ0IG9mIGV4cGxhbmFyaWEuXG5cbi8vYWxzbywgY2hhbmdlIFRocmVlYXN5X0Vudmlyb25tZW50IHRvIFRocmVlYXN5X1JlY29yZGVyIHRvIGRvd25sb2FkIGhpZ2gtcXVhbGl0eSBmcmFtZXMgb2YgYW4gYW5pbWF0aW9uXG5cbmltcG9ydCBDQ2FwdHVyZSBmcm9tICdjY2FwdHVyZS5qcyc7XG5pbXBvcnQgeyBEZXRlY3RvciB9IGZyb20gJy4uL2xpYi9XZWJHTF9EZXRlY3Rvci5qcyc7XG5pbXBvcnQgeyBzZXRUaHJlZUVudmlyb25tZW50LCBnZXRUaHJlZUVudmlyb25tZW50IH0gZnJvbSAnLi9UaHJlZUVudmlyb25tZW50LmpzJztcblxuZnVuY3Rpb24gVGhyZWVhc3lFbnZpcm9ubWVudChjYW52YXNFbGVtID0gbnVsbCl7XG5cdHRoaXMucHJldl90aW1lc3RlcCA9IDA7XG4gICAgdGhpcy5zaG91bGRDcmVhdGVDYW52YXMgPSAoY2FudmFzRWxlbSA9PT0gbnVsbCk7XG5cblx0aWYoIURldGVjdG9yLndlYmdsKURldGVjdG9yLmFkZEdldFdlYkdMTWVzc2FnZSgpO1xuXG4gICAgLy9mb3YsIGFzcGVjdCwgbmVhciwgZmFyXG5cdHRoaXMuY2FtZXJhID0gbmV3IFRIUkVFLlBlcnNwZWN0aXZlQ2FtZXJhKCA3MCwgd2luZG93LmlubmVyV2lkdGggLyB3aW5kb3cuaW5uZXJIZWlnaHQsIDAuMSwgMTAwMDAwMDAgKTtcblx0Ly90aGlzLmNhbWVyYSA9IG5ldyBUSFJFRS5PcnRob2dyYXBoaWNDYW1lcmEoIDcwLCB3aW5kb3cuaW5uZXJXaWR0aCAvIHdpbmRvdy5pbm5lckhlaWdodCwgMC4xLCAxMCApO1xuXG5cdHRoaXMuY2FtZXJhLnBvc2l0aW9uLnNldCgwLCAwLCAxMCk7XG5cdHRoaXMuY2FtZXJhLmxvb2tBdChuZXcgVEhSRUUuVmVjdG9yMygwLDAsMCkpO1xuXG5cblx0Ly9jcmVhdGUgY2FtZXJhLCBzY2VuZSwgdGltZXIsIHJlbmRlcmVyIG9iamVjdHNcblx0Ly9jcmFldGUgcmVuZGVyIG9iamVjdFxuXG5cblx0XG5cdHRoaXMuc2NlbmUgPSBuZXcgVEhSRUUuU2NlbmUoKTtcblx0dGhpcy5zY2VuZS5hZGQodGhpcy5jYW1lcmEpO1xuXG5cdC8vcmVuZGVyZXJcblx0bGV0IHJlbmRlcmVyT3B0aW9ucyA9IHsgYW50aWFsaWFzOiB0cnVlfTtcblxuICAgIGlmKCF0aGlzLnNob3VsZENyZWF0ZUNhbnZhcyl7XG4gICAgICAgIHJlbmRlcmVyT3B0aW9ucy5jYW52YXMgPSBjYW52YXNFbGVtO1xuICAgIH1cblxuXHR0aGlzLnJlbmRlcmVyID0gbmV3IFRIUkVFLldlYkdMUmVuZGVyZXIoIHJlbmRlcmVyT3B0aW9ucyApO1xuXHR0aGlzLnJlbmRlcmVyLnNldFBpeGVsUmF0aW8oIHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvICk7XG5cdHRoaXMucmVuZGVyZXIuc2V0Q2xlYXJDb2xvcihuZXcgVEhSRUUuQ29sb3IoMHhGRkZGRkYpLCAxLjApO1xuXG5cbiAgICB0aGlzLnJlc2l6ZUNhbnZhc0lmTmVjZXNzYXJ5KCk7IC8vcmVzaXplIGNhbnZhcyB0byB3aW5kb3cgc2l6ZSBhbmQgc2V0IGFzcGVjdCByYXRpb1xuXHQvKlxuXHR0aGlzLnJlbmRlcmVyLmdhbW1hSW5wdXQgPSB0cnVlO1xuXHR0aGlzLnJlbmRlcmVyLmdhbW1hT3V0cHV0ID0gdHJ1ZTtcblx0dGhpcy5yZW5kZXJlci5zaGFkb3dNYXAuZW5hYmxlZCA9IHRydWU7XG5cdHRoaXMucmVuZGVyZXIudnIuZW5hYmxlZCA9IHRydWU7XG5cdCovXG5cblx0dGhpcy50aW1lU2NhbGUgPSAxO1xuXHR0aGlzLmVsYXBzZWRUaW1lID0gMDtcblx0dGhpcy50cnVlRWxhcHNlZFRpbWUgPSAwO1xuXG4gICAgaWYodGhpcy5zaG91bGRDcmVhdGVDYW52YXMpe1xuXHQgICAgdGhpcy5jb250YWluZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCAnZGl2JyApO1xuXHQgICAgdGhpcy5jb250YWluZXIuYXBwZW5kQ2hpbGQoIHRoaXMucmVuZGVyZXIuZG9tRWxlbWVudCApO1xuICAgIH1cblxuXHR0aGlzLnJlbmRlcmVyLmRvbUVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lciggJ21vdXNlZG93bicsIHRoaXMub25Nb3VzZURvd24uYmluZCh0aGlzKSwgZmFsc2UgKTtcblx0dGhpcy5yZW5kZXJlci5kb21FbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoICdtb3VzZXVwJywgdGhpcy5vbk1vdXNlVXAuYmluZCh0aGlzKSwgZmFsc2UgKTtcblx0dGhpcy5yZW5kZXJlci5kb21FbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoICd0b3VjaHN0YXJ0JywgdGhpcy5vbk1vdXNlRG93bi5iaW5kKHRoaXMpLCBmYWxzZSApO1xuXHR0aGlzLnJlbmRlcmVyLmRvbUVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lciggJ3RvdWNoZW5kJywgdGhpcy5vbk1vdXNlVXAuYmluZCh0aGlzKSwgZmFsc2UgKTtcblxuXHQvKlxuXHQvL3JlbmRlcmVyLnZyLmVuYWJsZWQgPSB0cnVlOyBcblx0d2luZG93LmFkZEV2ZW50TGlzdGVuZXIoICd2cmRpc3BsYXlwb2ludGVycmVzdHJpY3RlZCcsIG9uUG9pbnRlclJlc3RyaWN0ZWQsIGZhbHNlICk7XG5cdHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCAndnJkaXNwbGF5cG9pbnRlcnVucmVzdHJpY3RlZCcsIG9uUG9pbnRlclVucmVzdHJpY3RlZCwgZmFsc2UgKTtcblx0ZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZCggV0VCVlIuY3JlYXRlQnV0dG9uKCByZW5kZXJlciApICk7XG5cdCovXG5cblx0d2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ2xvYWQnLCB0aGlzLm9uUGFnZUxvYWQuYmluZCh0aGlzKSwgZmFsc2UpO1xuXG5cdHRoaXMuY2xvY2sgPSBuZXcgVEhSRUUuQ2xvY2soKTtcblxuXHR0aGlzLklTX1JFQ09SRElORyA9IGZhbHNlOyAvLyBxdWVyeWFibGUgaWYgb25lIHdhbnRzIHRvIGRvIHRoaW5ncyBsaWtlIGJlZWYgdXAgcGFydGljbGUgY291bnRzIGZvciByZW5kZXJcblxuICAgIGlmKCF0aGlzLnNob3VsZENyZWF0ZUNhbnZhcyAmJiBjYW52YXNFbGVtLm9mZnNldFdpZHRoKXtcbiAgICAgICAgLy9JZiB0aGUgY2FudmFzRWxlbWVudCBpcyBhbHJlYWR5IGxvYWRlZCwgdGhlbiB0aGUgJ2xvYWQnIGV2ZW50IGhhcyBhbHJlYWR5IGZpcmVkLiBXZSBuZWVkIHRvIHRyaWdnZXIgaXQgb3Vyc2VsdmVzLlxuICAgICAgICB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMub25QYWdlTG9hZC5iaW5kKHRoaXMpKTtcbiAgICB9XG59XG5cblRocmVlYXN5RW52aXJvbm1lbnQucHJvdG90eXBlLm9uUGFnZUxvYWQgPSBmdW5jdGlvbigpIHtcblx0Y29uc29sZS5sb2coXCJUaHJlZWFzeV9TZXR1cCBsb2FkZWQhXCIpO1xuXHRpZih0aGlzLnNob3VsZENyZWF0ZUNhbnZhcyl7XG5cdFx0ZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZCggdGhpcy5jb250YWluZXIgKTtcblx0fVxuXG5cdHRoaXMuc3RhcnQoKTtcbn1cblRocmVlYXN5RW52aXJvbm1lbnQucHJvdG90eXBlLnN0YXJ0ID0gZnVuY3Rpb24oKXtcblx0dGhpcy5wcmV2X3RpbWVzdGVwID0gcGVyZm9ybWFuY2Uubm93KCk7XG5cdHRoaXMuY2xvY2suc3RhcnQoKTtcblx0dGhpcy5yZW5kZXIodGhpcy5wcmV2X3RpbWVzdGVwKTtcbn1cblxuVGhyZWVhc3lFbnZpcm9ubWVudC5wcm90b3R5cGUub25Nb3VzZURvd24gPSBmdW5jdGlvbigpIHtcblx0dGhpcy5pc01vdXNlRG93biA9IHRydWU7XG59XG5UaHJlZWFzeUVudmlyb25tZW50LnByb3RvdHlwZS5vbk1vdXNlVXA9IGZ1bmN0aW9uKCkge1xuXHR0aGlzLmlzTW91c2VEb3duID0gZmFsc2U7XG59XG5UaHJlZWFzeUVudmlyb25tZW50LnByb3RvdHlwZS5vblBvaW50ZXJSZXN0cmljdGVkPSBmdW5jdGlvbigpIHtcblx0dmFyIHBvaW50ZXJMb2NrRWxlbWVudCA9IHRoaXMucmVuZGVyZXIuZG9tRWxlbWVudDtcblx0aWYgKCBwb2ludGVyTG9ja0VsZW1lbnQgJiYgdHlwZW9mKHBvaW50ZXJMb2NrRWxlbWVudC5yZXF1ZXN0UG9pbnRlckxvY2spID09PSAnZnVuY3Rpb24nICkge1xuXHRcdHBvaW50ZXJMb2NrRWxlbWVudC5yZXF1ZXN0UG9pbnRlckxvY2soKTtcblx0fVxufVxuVGhyZWVhc3lFbnZpcm9ubWVudC5wcm90b3R5cGUub25Qb2ludGVyVW5yZXN0cmljdGVkPSBmdW5jdGlvbigpIHtcblx0dmFyIGN1cnJlbnRQb2ludGVyTG9ja0VsZW1lbnQgPSBkb2N1bWVudC5wb2ludGVyTG9ja0VsZW1lbnQ7XG5cdHZhciBleHBlY3RlZFBvaW50ZXJMb2NrRWxlbWVudCA9IHRoaXMucmVuZGVyZXIuZG9tRWxlbWVudDtcblx0aWYgKCBjdXJyZW50UG9pbnRlckxvY2tFbGVtZW50ICYmIGN1cnJlbnRQb2ludGVyTG9ja0VsZW1lbnQgPT09IGV4cGVjdGVkUG9pbnRlckxvY2tFbGVtZW50ICYmIHR5cGVvZihkb2N1bWVudC5leGl0UG9pbnRlckxvY2spID09PSAnZnVuY3Rpb24nICkge1xuXHRcdGRvY3VtZW50LmV4aXRQb2ludGVyTG9jaygpO1xuXHR9XG59XG5UaHJlZWFzeUVudmlyb25tZW50LnByb3RvdHlwZS5ldmVuaWZ5ID0gZnVuY3Rpb24oeCl7XG5cdGlmKHggJSAyID09IDEpe1xuXHRcdHJldHVybiB4KzE7XG5cdH1cblx0cmV0dXJuIHg7XG59XG5UaHJlZWFzeUVudmlyb25tZW50LnByb3RvdHlwZS5yZXNpemVDYW52YXNJZk5lY2Vzc2FyeT0gZnVuY3Rpb24oKSB7XG4gICAgLy9odHRwczovL3dlYmdsMmZ1bmRhbWVudGFscy5vcmcvd2ViZ2wvbGVzc29ucy93ZWJnbC1hbnRpLXBhdHRlcm5zLmh0bWwgeWVzLCBldmVyeSBmcmFtZS5cbiAgICAvL3RoaXMgaGFuZGxlcyB0aGUgZWRnZSBjYXNlIHdoZXJlIHRoZSBjYW52YXMgc2l6ZSBjaGFuZ2VzIGJ1dCB0aGUgd2luZG93IHNpemUgZG9lc24ndFxuXG4gICAgbGV0IHdpZHRoID0gd2luZG93LmlubmVyV2lkdGg7XG4gICAgbGV0IGhlaWdodCA9IHdpbmRvdy5pbm5lckhlaWdodDtcbiAgICBcbiAgICBpZighdGhpcy5zaG91bGRDcmVhdGVDYW52YXMpeyAvLyBhIGNhbnZhcyB3YXMgcHJvdmlkZWQgZXh0ZXJuYWxseVxuICAgICAgICB3aWR0aCA9IHRoaXMucmVuZGVyZXIuZG9tRWxlbWVudC5jbGllbnRXaWR0aDtcbiAgICAgICAgaGVpZ2h0ID0gdGhpcy5yZW5kZXJlci5kb21FbGVtZW50LmNsaWVudEhlaWdodDtcbiAgICB9XG5cbiAgICBpZih3aWR0aCAhPSB0aGlzLnJlbmRlcmVyLmRvbUVsZW1lbnQud2lkdGggfHwgaGVpZ2h0ICE9IHRoaXMucmVuZGVyZXIuZG9tRWxlbWVudC5oZWlnaHQpe1xuICAgICAgICAvL2NhbnZhcyBkaW1lbnNpb25zIGNoYW5nZWQsIHVwZGF0ZSB0aGUgaW50ZXJuYWwgcmVzb2x1dGlvblxuXG5cdCAgICB0aGlzLmNhbWVyYS5hc3BlY3QgPSB3aWR0aCAvIGhlaWdodDtcbiAgICAgICAgLy90aGlzLmNhbWVyYS5zZXRGb2NhbExlbmd0aCgzMCk7IC8vaWYgSSB1c2UgdGhpcywgdGhlIGNhbWVyYSB3aWxsIGtlZXAgYSBjb25zdGFudCB3aWR0aCBpbnN0ZWFkIG9mIGNvbnN0YW50IGhlaWdodFxuXHQgICAgdGhpcy5hc3BlY3QgPSB0aGlzLmNhbWVyYS5hc3BlY3Q7XG5cdCAgICB0aGlzLmNhbWVyYS51cGRhdGVQcm9qZWN0aW9uTWF0cml4KCk7XG5cdCAgICB0aGlzLnJlbmRlcmVyLnNldFNpemUoIHRoaXMuZXZlbmlmeSh3aWR0aCksIHRoaXMuZXZlbmlmeShoZWlnaHQpLHRoaXMuc2hvdWxkQ3JlYXRlQ2FudmFzICk7XG4gICAgfVxufVxuVGhyZWVhc3lFbnZpcm9ubWVudC5wcm90b3R5cGUubGlzdGVuZXJzID0ge1widXBkYXRlXCI6IFtdLFwicmVuZGVyXCI6W119OyAvL3VwZGF0ZSBldmVudCBsaXN0ZW5lcnNcblRocmVlYXN5RW52aXJvbm1lbnQucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKHRpbWVzdGVwKXtcbiAgICB0aGlzLnJlc2l6ZUNhbnZhc0lmTmVjZXNzYXJ5KCk7XG5cbiAgICB2YXIgcmVhbHRpbWVEZWx0YSA9IHRoaXMuY2xvY2suZ2V0RGVsdGEoKTtcblx0dmFyIGRlbHRhID0gcmVhbHRpbWVEZWx0YSp0aGlzLnRpbWVTY2FsZTtcblx0dGhpcy5lbGFwc2VkVGltZSArPSBkZWx0YTtcbiAgICB0aGlzLnRydWVFbGFwc2VkVGltZSArPSByZWFsdGltZURlbHRhO1xuXHQvL2dldCB0aW1lc3RlcFxuXHRmb3IodmFyIGk9MDtpPHRoaXMubGlzdGVuZXJzW1widXBkYXRlXCJdLmxlbmd0aDtpKyspe1xuXHRcdHRoaXMubGlzdGVuZXJzW1widXBkYXRlXCJdW2ldKHtcInRcIjp0aGlzLmVsYXBzZWRUaW1lLFwiZGVsdGFcIjpkZWx0YSwncmVhbHRpbWVEZWx0YSc6cmVhbHRpbWVEZWx0YX0pO1xuXHR9XG5cblx0dGhpcy5yZW5kZXJlci5yZW5kZXIoIHRoaXMuc2NlbmUsIHRoaXMuY2FtZXJhICk7XG5cblx0Zm9yKHZhciBpPTA7aTx0aGlzLmxpc3RlbmVyc1tcInJlbmRlclwiXS5sZW5ndGg7aSsrKXtcblx0XHR0aGlzLmxpc3RlbmVyc1tcInJlbmRlclwiXVtpXSgpO1xuXHR9XG5cblx0dGhpcy5wcmV2X3RpbWVzdGVwID0gdGltZXN0ZXA7XG5cdHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5yZW5kZXIuYmluZCh0aGlzKSk7XG59XG5UaHJlZWFzeUVudmlyb25tZW50LnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uKGV2ZW50X25hbWUsIGZ1bmMpe1xuXHQvL1JlZ2lzdGVycyBhbiBldmVudCBsaXN0ZW5lci5cblx0Ly9lYWNoIGxpc3RlbmVyIHdpbGwgYmUgY2FsbGVkIHdpdGggYW4gb2JqZWN0IGNvbnNpc3Rpbmcgb2Y6XG5cdC8vXHR7dDogPGN1cnJlbnQgdGltZSBpbiBzPiwgXCJkZWx0YVwiOiA8ZGVsdGEsIGluIG1zPn1cblx0Ly8gYW4gdXBkYXRlIGV2ZW50IGZpcmVzIGJlZm9yZSBhIHJlbmRlci4gYSByZW5kZXIgZXZlbnQgZmlyZXMgcG9zdC1yZW5kZXIuXG5cdGlmKGV2ZW50X25hbWUgPT0gXCJ1cGRhdGVcIil7IFxuXHRcdHRoaXMubGlzdGVuZXJzW1widXBkYXRlXCJdLnB1c2goZnVuYyk7XG5cdH1lbHNlIGlmKGV2ZW50X25hbWUgPT0gXCJyZW5kZXJcIil7IFxuXHRcdHRoaXMubGlzdGVuZXJzW1wicmVuZGVyXCJdLnB1c2goZnVuYyk7XG5cdH1lbHNle1xuXHRcdGNvbnNvbGUuZXJyb3IoXCJJbnZhbGlkIGV2ZW50IG5hbWUhXCIpXG5cdH1cbn1cblRocmVlYXN5RW52aXJvbm1lbnQucHJvdG90eXBlLnJlbW92ZUV2ZW50TGlzdGVuZXIgPSBmdW5jdGlvbihldmVudF9uYW1lLCBmdW5jKXtcblx0Ly9VbnJlZ2lzdGVycyBhbiBldmVudCBsaXN0ZW5lciwgdW5kb2luZyBhbiBUaHJlZWFzeV9zZXR1cC5vbigpIGV2ZW50IGxpc3RlbmVyLlxuXHQvL3RoZSBuYW1pbmcgc2NoZW1lIG1pZ2h0IG5vdCBiZSB0aGUgYmVzdCBoZXJlLlxuXHRpZihldmVudF9uYW1lID09IFwidXBkYXRlXCIpeyBcblx0XHRsZXQgaW5kZXggPSB0aGlzLmxpc3RlbmVyc1tcInVwZGF0ZVwiXS5pbmRleE9mKGZ1bmMpO1xuXHRcdHRoaXMubGlzdGVuZXJzW1widXBkYXRlXCJdLnNwbGljZShpbmRleCwxKTtcblx0fSBlbHNlIGlmKGV2ZW50X25hbWUgPT0gXCJyZW5kZXJcIil7IFxuXHRcdGxldCBpbmRleCA9IHRoaXMubGlzdGVuZXJzW1wicmVuZGVyXCJdLmluZGV4T2YoZnVuYyk7XG5cdFx0dGhpcy5saXN0ZW5lcnNbXCJyZW5kZXJcIl0uc3BsaWNlKGluZGV4LDEpO1xuXHR9ZWxzZXtcblx0XHRjb25zb2xlLmVycm9yKFwiTm9uZXhpc3RlbnQgZXZlbnQgbmFtZSFcIilcblx0fVxufVxuVGhyZWVhc3lFbnZpcm9ubWVudC5wcm90b3R5cGUub2ZmID0gVGhyZWVhc3lFbnZpcm9ubWVudC5wcm90b3R5cGUucmVtb3ZlRXZlbnRMaXN0ZW5lcjsgLy9hbGlhcyB0byBtYXRjaCBUaHJlZWFzeUVudmlyb25tZW50Lm9uXG5cbmNsYXNzIFRocmVlYXN5UmVjb3JkZXIgZXh0ZW5kcyBUaHJlZWFzeUVudmlyb25tZW50e1xuXHQvL2Jhc2VkIG9uIGh0dHA6Ly93d3cudHlzb25jYWRlbmhlYWQuY29tL2Jsb2cvZXhwb3J0aW5nLWNhbnZhcy1hbmltYXRpb24tdG8tbW92LyB0byByZWNvcmQgYW4gYW5pbWF0aW9uXG5cdC8vd2hlbiBkb25lLCAgICAgZmZtcGVnIC1yIDYwIC1mcmFtZXJhdGUgNjAgLWkgLi8lMDdkLnBuZyAtdmNvZGVjIGxpYngyNjQgLXBpeF9mbXQgeXV2NDIwcCAtY3JmOnYgMCB2aWRlby5tcDRcbiAgICAvLyB0byBwZXJmb3JtIG1vdGlvbiBibHVyIG9uIGFuIG92ZXJzYW1wbGVkIHZpZGVvLCBmZm1wZWcgLWkgdmlkZW8ubXA0IC12ZiB0YmxlbmQ9YWxsX21vZGU9YXZlcmFnZSxmcmFtZXN0ZXA9MiB2aWRlbzIubXA0XG5cdC8vdGhlbiwgYWRkIHRoZSB5dXY0MjBwIHBpeGVscyAod2hpY2ggZm9yIHNvbWUgcmVhc29uIGlzbid0IGRvbmUgYnkgdGhlIHByZXYgY29tbWFuZCkgYnk6XG5cdC8vIGZmbXBlZyAtaSB2aWRlby5tcDQgLXZjb2RlYyBsaWJ4MjY0IC1waXhfZm10IHl1djQyMHAgLXN0cmljdCAtMiAtYWNvZGVjIGFhYyBmaW5pc2hlZF92aWRlby5tcDRcblx0Ly9jaGVjayB3aXRoIGZmbXBlZyAtaSBmaW5pc2hlZF92aWRlby5tcDRcblxuXHRjb25zdHJ1Y3RvcihmcHM9MzAsIGxlbmd0aCA9IDUsIGNhbnZhc0VsZW0gPSBudWxsKXtcblx0XHQvKiBmcHMgaXMgZXZpZGVudCwgYXV0b3N0YXJ0IGlzIGEgYm9vbGVhbiAoYnkgZGVmYXVsdCwgdHJ1ZSksIGFuZCBsZW5ndGggaXMgaW4gcy4qL1xuXHRcdHN1cGVyKGNhbnZhc0VsZW0pO1xuXHRcdHRoaXMuZnBzID0gZnBzO1xuXHRcdHRoaXMuZWxhcHNlZFRpbWUgPSAwO1xuXHRcdHRoaXMuZnJhbWVDb3VudCA9IGZwcyAqIGxlbmd0aDtcblx0XHR0aGlzLmZyYW1lc19yZW5kZXJlZCA9IDA7XG5cblx0XHR0aGlzLmNhcHR1cmVyID0gbmV3IENDYXB0dXJlKCB7XG5cdFx0XHRmcmFtZXJhdGU6IGZwcyxcblx0XHRcdGZvcm1hdDogJ3BuZycsXG5cdFx0XHRuYW1lOiBkb2N1bWVudC50aXRsZSxcblx0XHRcdC8vdmVyYm9zZTogdHJ1ZSxcblx0XHR9ICk7XG5cblx0XHR0aGlzLnJlbmRlcmluZyA9IGZhbHNlO1xuXG5cdFx0dGhpcy5JU19SRUNPUkRJTkcgPSB0cnVlO1xuXHR9XG5cdHN0YXJ0KCl7XG5cdFx0Ly9tYWtlIGEgcmVjb3JkaW5nIHNpZ25cblx0XHR0aGlzLnJlY29yZGluZ19pY29uID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcblx0XHR0aGlzLnJlY29yZGluZ19pY29uLnN0eWxlLndpZHRoPVwiMjBweFwiXG5cdFx0dGhpcy5yZWNvcmRpbmdfaWNvbi5zdHlsZS5oZWlnaHQ9XCIyMHB4XCJcblx0XHR0aGlzLnJlY29yZGluZ19pY29uLnN0eWxlLnBvc2l0aW9uID0gJ2Fic29sdXRlJztcblx0XHR0aGlzLnJlY29yZGluZ19pY29uLnN0eWxlLnRvcCA9ICcyMHB4Jztcblx0XHR0aGlzLnJlY29yZGluZ19pY29uLnN0eWxlLmxlZnQgPSAnMjBweCc7XG5cdFx0dGhpcy5yZWNvcmRpbmdfaWNvbi5zdHlsZS5ib3JkZXJSYWRpdXMgPSAnMTBweCc7XG5cdFx0dGhpcy5yZWNvcmRpbmdfaWNvbi5zdHlsZS5iYWNrZ3JvdW5kQ29sb3IgPSAncmVkJztcblx0XHRkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKHRoaXMucmVjb3JkaW5nX2ljb24pO1xuXG5cdFx0dGhpcy5mcmFtZUNvdW50ZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuXHRcdHRoaXMuZnJhbWVDb3VudGVyLnN0eWxlLnBvc2l0aW9uID0gJ2Fic29sdXRlJztcblx0XHR0aGlzLmZyYW1lQ291bnRlci5zdHlsZS50b3AgPSAnMjBweCc7XG5cdFx0dGhpcy5mcmFtZUNvdW50ZXIuc3R5bGUubGVmdCA9ICc1MHB4Jztcblx0XHR0aGlzLmZyYW1lQ291bnRlci5zdHlsZS5jb2xvciA9ICdibGFjayc7XG5cdFx0dGhpcy5mcmFtZUNvdW50ZXIuc3R5bGUuYm9yZGVyUmFkaXVzID0gJzEwcHgnO1xuXHRcdHRoaXMuZnJhbWVDb3VudGVyLnN0eWxlLmJhY2tncm91bmRDb2xvciA9ICdyZ2JhKDI1NSwyNTUsMjU1LDAuMSknO1xuXHRcdGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQodGhpcy5mcmFtZUNvdW50ZXIpO1xuXG5cdFx0dGhpcy5jYXB0dXJlci5zdGFydCgpO1xuXHRcdHRoaXMucmVuZGVyaW5nID0gdHJ1ZTtcblx0XHR0aGlzLnJlbmRlcigpO1xuXHR9XG5cdHJlbmRlcih0aW1lc3RlcCl7XG4gICAgICAgIHZhciByZWFsdGltZURlbHRhID0gMS90aGlzLmZwczsvL2lnbm9yaW5nIHRoZSB0cnVlIHRpbWUsIGNhbGN1bGF0ZSB0aGUgZGVsdGFcblx0XHR2YXIgZGVsdGEgPSByZWFsdGltZURlbHRhKnRoaXMudGltZVNjYWxlOyBcblx0XHR0aGlzLmVsYXBzZWRUaW1lICs9IGRlbHRhO1xuICAgICAgICB0aGlzLnRydWVFbGFwc2VkVGltZSArPSByZWFsdGltZURlbHRhO1xuXG5cdFx0Ly9nZXQgdGltZXN0ZXBcblx0XHRmb3IodmFyIGk9MDtpPHRoaXMubGlzdGVuZXJzW1widXBkYXRlXCJdLmxlbmd0aDtpKyspe1xuXHRcdFx0dGhpcy5saXN0ZW5lcnNbXCJ1cGRhdGVcIl1baV0oe1widFwiOnRoaXMuZWxhcHNlZFRpbWUsXCJkZWx0YVwiOmRlbHRhLCAncmVhbHRpbWVEZWx0YSc6cmVhbHRpbWVEZWx0YX0pO1xuXHRcdH1cblxuXHRcdHRoaXMucmVuZGVyZXIucmVuZGVyKCB0aGlzLnNjZW5lLCB0aGlzLmNhbWVyYSApO1xuXG5cdFx0Zm9yKHZhciBpPTA7aTx0aGlzLmxpc3RlbmVyc1tcInJlbmRlclwiXS5sZW5ndGg7aSsrKXtcblx0XHRcdHRoaXMubGlzdGVuZXJzW1wicmVuZGVyXCJdW2ldKCk7XG5cdFx0fVxuXG5cblx0XHR0aGlzLnJlY29yZF9mcmFtZSgpO1xuXHRcdHRoaXMucmVjb3JkaW5nX2ljb24uc3R5bGUuYm9yZGVyUmFkaXVzID0gJzEwcHgnO1xuXG5cdFx0d2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLnJlbmRlci5iaW5kKHRoaXMpKTtcblx0fVxuXHRyZWNvcmRfZnJhbWUoKXtcblx0Ly9cdGxldCBjdXJyZW50X2ZyYW1lID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignY2FudmFzJykudG9EYXRhVVJMKCk7XG5cblx0XHR0aGlzLmNhcHR1cmVyLmNhcHR1cmUoIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ2NhbnZhcycpICk7XG5cblx0XHR0aGlzLmZyYW1lQ291bnRlci5pbm5lckhUTUwgPSB0aGlzLmZyYW1lc19yZW5kZXJlZCArIFwiIC8gXCIgKyB0aGlzLmZyYW1lQ291bnQ7IC8vdXBkYXRlIHRpbWVyXG5cblx0XHR0aGlzLmZyYW1lc19yZW5kZXJlZCsrO1xuXG5cblx0XHRpZih0aGlzLmZyYW1lc19yZW5kZXJlZD50aGlzLmZyYW1lQ291bnQpe1xuXHRcdFx0dGhpcy5yZW5kZXIgPSBudWxsOyAvL2hhY2t5IHdheSBvZiBzdG9wcGluZyB0aGUgcmVuZGVyaW5nXG5cdFx0XHR0aGlzLnJlY29yZGluZ19pY29uLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcblx0XHRcdC8vdGhpcy5mcmFtZUNvdW50ZXIuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xuXG5cdFx0XHR0aGlzLnJlbmRlcmluZyA9IGZhbHNlO1xuXHRcdFx0dGhpcy5jYXB0dXJlci5zdG9wKCk7XG5cdFx0XHQvLyBkZWZhdWx0IHNhdmUsIHdpbGwgZG93bmxvYWQgYXV0b21hdGljYWxseSBhIGZpbGUgY2FsbGVkIHtuYW1lfS5leHRlbnNpb24gKHdlYm0vZ2lmL3Rhcilcblx0XHRcdHRoaXMuY2FwdHVyZXIuc2F2ZSgpO1xuXHRcdH1cblx0fVxuXHRyZXNpemVDYW52YXNJZk5lY2Vzc2FyeSgpIHtcblx0XHQvL3N0b3AgcmVjb3JkaW5nIGlmIHdpbmRvdyBzaXplIGNoYW5nZXNcblx0XHRpZih0aGlzLnJlbmRlcmluZyAmJiB3aW5kb3cuaW5uZXJXaWR0aCAvIHdpbmRvdy5pbm5lckhlaWdodCAhPSB0aGlzLmFzcGVjdCl7XG5cdFx0XHR0aGlzLmNhcHR1cmVyLnN0b3AoKTtcblx0XHRcdHRoaXMucmVuZGVyID0gbnVsbDsgLy9oYWNreSB3YXkgb2Ygc3RvcHBpbmcgdGhlIHJlbmRlcmluZ1xuXHRcdFx0YWxlcnQoXCJBYm9ydGluZyByZWNvcmQ6IFdpbmRvdy1zaXplIGNoYW5nZSBkZXRlY3RlZCFcIik7XG5cdFx0XHR0aGlzLnJlbmRlcmluZyA9IGZhbHNlO1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRzdXBlci5yZXNpemVDYW52YXNJZk5lY2Vzc2FyeSgpO1xuXHR9XG59XG5cbmZ1bmN0aW9uIHNldHVwVGhyZWUoZnBzPTMwLCBsZW5ndGggPSA1LCBjYW52YXNFbGVtID0gbnVsbCl7XG5cdC8qIFNldCB1cCB0aGUgdGhyZWUuanMgZW52aXJvbm1lbnQuIFN3aXRjaCBiZXR3ZWVuIGNsYXNzZXMgZHluYW1pY2FsbHkgc28gdGhhdCB5b3UgY2FuIHJlY29yZCBieSBhcHBlbmRpbmcgXCI/cmVjb3JkPXRydWVcIiB0byBhbiB1cmwuIFRoZW4gRVhQLnRocmVlRW52aXJvbm1lbnQuY2FtZXJhIGFuZCBFWFAudGhyZWVFbnZpcm9ubWVudC5zY2VuZSB3b3JrLCBhcyB3ZWxsIGFzIEVYUC50aHJlZUVudmlyb25tZW50Lm9uKCdldmVudCBuYW1lJywgY2FsbGJhY2spLiBPbmx5IG9uZSBlbnZpcm9ubWVudCBleGlzdHMgYXQgYSB0aW1lLlxuXG4gICAgVGhlIHJldHVybmVkIG9iamVjdCBpcyBhIHNpbmdsZXRvbjogbXVsdGlwbGUgY2FsbHMgd2lsbCByZXR1cm4gdGhlIHNhbWUgb2JqZWN0OiBFWFAudGhyZWVFbnZpcm9ubWVudC4qL1xuXHR2YXIgcmVjb3JkZXIgPSBudWxsO1xuXHR2YXIgaXNfcmVjb3JkaW5nID0gZmFsc2U7XG5cblx0Ly9leHRyYWN0IHJlY29yZCBwYXJhbWV0ZXIgZnJvbSB1cmxcblx0dmFyIHBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoZG9jdW1lbnQubG9jYXRpb24uc2VhcmNoKTtcblx0bGV0IHJlY29yZFN0cmluZyA9IHBhcmFtcy5nZXQoXCJyZWNvcmRcIik7XG5cblx0aWYocmVjb3JkU3RyaW5nKXsgLy9kZXRlY3QgaWYgVVJMIHBhcmFtcyBpbmNsdWRlID9yZWNvcmQ9MSBvciA/cmVjb3JkPXRydWVcbiAgICAgICAgcmVjb3JkU3RyaW5nID0gcmVjb3JkU3RyaW5nLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGlzX3JlY29yZGluZyA9IChyZWNvcmRTdHJpbmcgPT0gXCJ0cnVlXCIgfHwgcmVjb3JkU3RyaW5nID09IFwiMVwiKTtcbiAgICB9XG5cbiAgICBsZXQgdGhyZWVFbnZpcm9ubWVudCA9IGdldFRocmVlRW52aXJvbm1lbnQoKTtcbiAgICBpZih0aHJlZUVudmlyb25tZW50ICE9PSBudWxsKXsvL3NpbmdsZXRvbiBoYXMgYWxyZWFkeSBiZWVuIGNyZWF0ZWRcbiAgICAgICAgcmV0dXJuIHRocmVlRW52aXJvbm1lbnQ7XG4gICAgfVxuXG5cdGlmKGlzX3JlY29yZGluZyl7XG5cdFx0dGhyZWVFbnZpcm9ubWVudCA9IG5ldyBUaHJlZWFzeVJlY29yZGVyKGZwcywgbGVuZ3RoLCBjYW52YXNFbGVtKTtcblx0fWVsc2V7XG5cdFx0dGhyZWVFbnZpcm9ubWVudCA9IG5ldyBUaHJlZWFzeUVudmlyb25tZW50KGNhbnZhc0VsZW0pO1xuXHR9XG4gICAgc2V0VGhyZWVFbnZpcm9ubWVudCh0aHJlZUVudmlyb25tZW50KTtcbiAgICByZXR1cm4gdGhyZWVFbnZpcm9ubWVudDtcbn1cblxuZXhwb3J0IHtzZXR1cFRocmVlLCBUaHJlZWFzeUVudmlyb25tZW50LCBUaHJlZWFzeVJlY29yZGVyfVxuIiwiYXN5bmMgZnVuY3Rpb24gZGVsYXkod2FpdFRpbWUpe1xuXHRyZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KXtcblx0XHR3aW5kb3cuc2V0VGltZW91dChyZXNvbHZlLCB3YWl0VGltZSk7XG5cdH0pO1xuXG59XG5cbmV4cG9ydCB7ZGVsYXl9O1xuIiwiLy9MaW5lT3V0cHV0U2hhZGVycy5qc1xuXG4vL2Jhc2VkIG9uIGh0dHBzOi8vbWF0dGRlc2wuc3ZidGxlLmNvbS9kcmF3aW5nLWxpbmVzLWlzLWhhcmQgYnV0IHdpdGggc2V2ZXJhbCBlcnJvcnMgY29ycmVjdGVkLCBiZXZlbCBzaGFkaW5nIGFkZGVkLCBhbmQgbW9yZVxuXG5jb25zdCBMSU5FX0pPSU5fVFlQRVMgPSB7XCJNSVRFUlwiOiAwLjIsIFwiQkVWRUxcIjoxLjIsXCJST1VORFwiOjIuMn07IC8vSSdkIHVzZSAwLDEsMiBidXQgSlMgZG9lc24ndCBhZGQgYSBkZWNpbWFsIHBsYWNlIGF0IHRoZSBlbmQgd2hlbiBpbnNlcnRpbmcgdGhlbSBpbiBhIHN0cmluZy4gY3Vyc2VkIGp1c3RpZmljYXRpb25cblxudmFyIHZTaGFkZXIgPSBbXG5cInVuaWZvcm0gZmxvYXQgYXNwZWN0O1wiLCAvL3VzZWQgdG8gY2FsaWJyYXRlIHNjcmVlbiBzcGFjZVxuXCJ1bmlmb3JtIGZsb2F0IGxpbmVXaWR0aDtcIiwgLy93aWR0aCBvZiBsaW5lXG5cInVuaWZvcm0gZmxvYXQgbGluZUpvaW5UeXBlO1wiLFxuLy9cImF0dHJpYnV0ZSB2ZWMzIHBvc2l0aW9uO1wiLCAvL2FkZGVkIGF1dG9tYXRpY2FsbHkgYnkgdGhyZWUuanNcblwiYXR0cmlidXRlIHZlYzMgbmV4dFBvaW50UG9zaXRpb247XCIsXG5cImF0dHJpYnV0ZSB2ZWMzIHByZXZpb3VzUG9pbnRQb3NpdGlvbjtcIixcblwiYXR0cmlidXRlIGZsb2F0IGRpcmVjdGlvbjtcIixcblwiYXR0cmlidXRlIGZsb2F0IGFwcHJvYWNoTmV4dE9yUHJldlZlcnRleDtcIixcblxuXCJ2YXJ5aW5nIGZsb2F0IGNyb3NzTGluZVBvc2l0aW9uO1wiLFxuXCJhdHRyaWJ1dGUgdmVjMyBjb2xvcjtcIixcblwidmFyeWluZyB2ZWMzIHZDb2xvcjtcIixcblwidmFyeWluZyB2ZWMyIGxpbmVTZWdtZW50QUNsaXBTcGFjZTtcIixcblwidmFyeWluZyB2ZWMyIGxpbmVTZWdtZW50QkNsaXBTcGFjZTtcIixcblwidmFyeWluZyBmbG9hdCB0aGlja25lc3M7XCIsXG5cblxuXCJ2YXJ5aW5nIHZlYzMgZGVidWdJbmZvO1wiLFxuXG5cInZlYzMgYW5nbGVfdG9faHVlKGZsb2F0IGFuZ2xlKSB7XCIsIC8vZm9yIGRlYnVnZ2luZ1xuXCIgIGFuZ2xlIC89IDMuMTQxNTkyKjIuO1wiLFxuXCIgIHJldHVybiBjbGFtcCgoYWJzKGZyYWN0KGFuZ2xlK3ZlYzMoMy4wLCAyLjAsIDEuMCkvMy4wKSo2LjAtMy4wKS0xLjApLCAwLjAsIDEuMCk7XCIsXG5cIn1cIixcblxuLy9naXZlbiBhbiB1bml0IHZlY3RvciwgbW92ZSBkaXN0IHVuaXRzIHBlcnBlbmRpY3VsYXIgdG8gaXQuXG5cInZlYzIgb2Zmc2V0UGVycGVuZGljdWxhckFsb25nU2NyZWVuU3BhY2UodmVjMiBkaXIsIGZsb2F0IHR3aWNlRGlzdCkge1wiLFxuICBcInZlYzIgbm9ybWFsID0gdmVjMigtZGlyLnksIGRpci54KSA7XCIsXG4gIFwibm9ybWFsICo9IHR3aWNlRGlzdC8yLjA7XCIsXG4gIFwibm9ybWFsLnggLz0gYXNwZWN0O1wiLFxuICBcInJldHVybiBub3JtYWw7XCIsXG5cIn1cIixcblxuXCJ2b2lkIG1haW4oKSB7XCIsXG5cbiAgXCJ2ZWMyIGFzcGVjdFZlYyA9IHZlYzIoYXNwZWN0LCAxLjApO1wiLFxuICBcIm1hdDQgcHJvalZpZXdNb2RlbCA9IHByb2plY3Rpb25NYXRyaXggKlwiLFxuICAgICAgICAgICAgXCJ2aWV3TWF0cml4ICogbW9kZWxNYXRyaXg7XCIsXG4gIFwidmVjNCBwcmV2aW91c1Byb2plY3RlZCA9IHByb2pWaWV3TW9kZWwgKiB2ZWM0KHByZXZpb3VzUG9pbnRQb3NpdGlvbiwgMS4wKTtcIixcbiAgXCJ2ZWM0IGN1cnJlbnRQcm9qZWN0ZWQgPSBwcm9qVmlld01vZGVsICogdmVjNChwb3NpdGlvbiwgMS4wKTtcIixcbiAgXCJ2ZWM0IG5leHRQcm9qZWN0ZWQgPSBwcm9qVmlld01vZGVsICogdmVjNChuZXh0UG9pbnRQb3NpdGlvbiwgMS4wKTtcIixcblxuXG4gIC8vZ2V0IDJEIHNjcmVlbiBzcGFjZSB3aXRoIFcgZGl2aWRlIGFuZCBhc3BlY3QgY29ycmVjdGlvblxuICBcInZlYzIgY3VycmVudFNjcmVlbiA9IGN1cnJlbnRQcm9qZWN0ZWQueHkgLyBjdXJyZW50UHJvamVjdGVkLncgKiBhc3BlY3RWZWM7XCIsXG4gIFwidmVjMiBwcmV2aW91c1NjcmVlbiA9IHByZXZpb3VzUHJvamVjdGVkLnh5IC8gcHJldmlvdXNQcm9qZWN0ZWQudyAqIGFzcGVjdFZlYztcIixcbiAgXCJ2ZWMyIG5leHRTY3JlZW4gPSBuZXh0UHJvamVjdGVkLnh5IC8gbmV4dFByb2plY3RlZC53ICogYXNwZWN0VmVjO1wiLFxuXG4gIC8vXCJjZW50ZXJQb2ludENsaXBTcGFjZVBvc2l0aW9uID0gY3VycmVudFByb2plY3RlZC54eSAvIGN1cnJlbnRQcm9qZWN0ZWQudztcIiwvL3NlbmQgdG8gZnJhZ21lbnQgc2hhZGVyXG4gIFwiY3Jvc3NMaW5lUG9zaXRpb24gPSBkaXJlY3Rpb247XCIsIC8vc2VuZCBkaXJlY3Rpb24gdG8gdGhlIGZyYWdtZW50IHNoYWRlclxuICBcInZDb2xvciA9IGNvbG9yO1wiLCAvL3NlbmQgZGlyZWN0aW9uIHRvIHRoZSBmcmFnbWVudCBzaGFkZXJcblxuICBcInRoaWNrbmVzcyA9IGxpbmVXaWR0aCAvIDQwMC47XCIsIC8vVE9ETzogY29udmVydCBsaW5lV2lkdGggdG8gcGl4ZWxzXG4gIFwiZmxvYXQgb3JpZW50YXRpb24gPSAoZGlyZWN0aW9uLTAuNSkqMi47XCIsXG5cbiAgLy9nZXQgZGlyZWN0aW9ucyBmcm9tIChDIC0gQikgYW5kIChCIC0gQSlcbiAgXCJ2ZWMyIHZlY0EgPSAoY3VycmVudFNjcmVlbiAtIHByZXZpb3VzU2NyZWVuKTtcIixcbiAgXCJ2ZWMyIHZlY0IgPSAobmV4dFNjcmVlbiAtIGN1cnJlbnRTY3JlZW4pO1wiLFxuICBcInZlYzIgZGlyQSA9IG5vcm1hbGl6ZSh2ZWNBKTtcIixcbiAgXCJ2ZWMyIGRpckIgPSBub3JtYWxpemUodmVjQik7XCIsXG5cbiAgLy9ERUJVR1xuICBcImxpbmVTZWdtZW50QUNsaXBTcGFjZSA9IG1peChwcmV2aW91c1NjcmVlbixjdXJyZW50U2NyZWVuLGFwcHJvYWNoTmV4dE9yUHJldlZlcnRleCkgLyBhc3BlY3RWZWM7XCIsLy9zZW5kIHRvIGZyYWdtZW50IHNoYWRlclxuICBcImxpbmVTZWdtZW50QkNsaXBTcGFjZSA9IG1peChjdXJyZW50U2NyZWVuLG5leHRTY3JlZW4sYXBwcm9hY2hOZXh0T3JQcmV2VmVydGV4KSAvIGFzcGVjdFZlYztcIiwvL3NlbmQgdG8gZnJhZ21lbnQgc2hhZGVyXG5cbiAgLy9zdGFydGluZyBwb2ludCB1c2VzIChuZXh0IC0gY3VycmVudClcbiAgXCJ2ZWMyIG9mZnNldCA9IHZlYzIoMC4wKTtcIixcbiAgXCJpZiAoY3VycmVudFNjcmVlbiA9PSBwcmV2aW91c1NjcmVlbikge1wiLFxuICBcIiAgb2Zmc2V0ID0gb2Zmc2V0UGVycGVuZGljdWxhckFsb25nU2NyZWVuU3BhY2UoZGlyQiAqIG9yaWVudGF0aW9uLCB0aGlja25lc3MpO1wiLFxuICAvL29mZnNldCArPSBkaXJCICogdGhpY2tuZXNzOyAvL2VuZCBjYXBcbiAgXCJ9IFwiLFxuICAvL2VuZGluZyBwb2ludCB1c2VzIChjdXJyZW50IC0gcHJldmlvdXMpXG4gIFwiZWxzZSBpZiAoY3VycmVudFNjcmVlbiA9PSBuZXh0U2NyZWVuKSB7XCIsXG4gIFwiICBvZmZzZXQgPSBvZmZzZXRQZXJwZW5kaWN1bGFyQWxvbmdTY3JlZW5TcGFjZShkaXJBICogb3JpZW50YXRpb24sIHRoaWNrbmVzcyk7XCIsXG4gIC8vb2Zmc2V0ICs9IGRpckEgKiB0aGlja25lc3M7IC8vZW5kIGNhcFxuICBcIn1cIixcbiAgXCIvL3NvbWV3aGVyZSBpbiBtaWRkbGUsIG5lZWRzIGEgam9pblwiLFxuICBcImVsc2Uge1wiLFxuICBcIiAgaWYgKGxpbmVKb2luVHlwZSA9PSBcIitMSU5FX0pPSU5fVFlQRVMuTUlURVIrXCIpIHtcIixcbiAgICAgICAgLy9jb3JuZXIgdHlwZTogbWl0ZXIuIFRoaXMgaXMgYnVnZ3kgKHRoZXJlJ3Mgbm8gbWl0ZXIgbGltaXQgeWV0KSBzbyBkb24ndCB1c2VcbiAgXCIgICAgLy9ub3cgY29tcHV0ZSB0aGUgbWl0ZXIgam9pbiBub3JtYWwgYW5kIGxlbmd0aFwiLFxuICBcIiAgICB2ZWMyIG1pdGVyRGlyZWN0aW9uID0gbm9ybWFsaXplKGRpckEgKyBkaXJCKTtcIixcbiAgXCIgICAgdmVjMiBwcmV2TGluZUV4dHJ1ZGVEaXJlY3Rpb24gPSB2ZWMyKC1kaXJBLnksIGRpckEueCk7XCIsXG4gIFwiICAgIHZlYzIgbWl0ZXIgPSB2ZWMyKC1taXRlckRpcmVjdGlvbi55LCBtaXRlckRpcmVjdGlvbi54KTtcIixcbiAgXCIgICAgZmxvYXQgbGVuID0gdGhpY2tuZXNzIC8gKGRvdChtaXRlciwgcHJldkxpbmVFeHRydWRlRGlyZWN0aW9uKSswLjAwMDEpO1wiLCAvL2NhbGN1bGF0ZS4gZG90IHByb2R1Y3QgaXMgYWx3YXlzID4gMFxuICBcIiAgICBvZmZzZXQgPSBvZmZzZXRQZXJwZW5kaWN1bGFyQWxvbmdTY3JlZW5TcGFjZShtaXRlckRpcmVjdGlvbiAqIG9yaWVudGF0aW9uLCBsZW4pO1wiLFxuICBcIiAgfSBlbHNlIGlmIChsaW5lSm9pblR5cGUgPT0gXCIrTElORV9KT0lOX1RZUEVTLkJFVkVMK1wiKXtcIixcbiAgICAvL2Nvcm5lciB0eXBlOiBiZXZlbFxuICBcIiAgICB2ZWMyIGRpciA9IG1peChkaXJBLCBkaXJCLCBhcHByb2FjaE5leHRPclByZXZWZXJ0ZXgpO1wiLFxuICBcIiAgICBvZmZzZXQgPSBvZmZzZXRQZXJwZW5kaWN1bGFyQWxvbmdTY3JlZW5TcGFjZShkaXIgKiBvcmllbnRhdGlvbiwgdGhpY2tuZXNzKTtcIixcbiAgXCIgIH0gZWxzZSBpZiAobGluZUpvaW5UeXBlID09IFwiK0xJTkVfSk9JTl9UWVBFUy5ST1VORCtcIil7XCIsXG4gICAgLy9jb3JuZXIgdHlwZTogcm91bmRcbiAgXCIgICAgdmVjMiBkaXIgPSBtaXgoZGlyQSwgZGlyQiwgYXBwcm9hY2hOZXh0T3JQcmV2VmVydGV4KTtcIixcbiAgXCIgICAgdmVjMiBoYWxmVGhpY2tuZXNzUGFzdFRoZVZlcnRleCA9IGRpcip0aGlja25lc3MvMi4gKiBhcHByb2FjaE5leHRPclByZXZWZXJ0ZXggLyBhc3BlY3RWZWM7XCIsXG4gIFwiICAgIG9mZnNldCA9IG9mZnNldFBlcnBlbmRpY3VsYXJBbG9uZ1NjcmVlblNwYWNlKGRpciAqIG9yaWVudGF0aW9uLCB0aGlja25lc3MpIC0gaGFsZlRoaWNrbmVzc1Bhc3RUaGVWZXJ0ZXg7XCIsIC8vZXh0ZW5kIHJlY3RzIHBhc3QgdGhlIHZlcnRleFxuICBcIiAgfSBlbHNlIHtcIiwgLy9ubyBsaW5lIGpvaW4gdHlwZSBzcGVjaWZpZWQsIGp1c3QgZ28gZm9yIHRoZSBwcmV2aW91cyBwb2ludFxuICBcIiAgICBvZmZzZXQgPSBvZmZzZXRQZXJwZW5kaWN1bGFyQWxvbmdTY3JlZW5TcGFjZShkaXJBLCB0aGlja25lc3MpO1wiLFxuICBcIiAgfVwiLFxuICBcIn1cIixcblxuICBcImRlYnVnSW5mbyA9IHZlYzMoYXBwcm9hY2hOZXh0T3JQcmV2VmVydGV4LCBvcmllbnRhdGlvbiwgMC4wKTtcIiwgLy9UT0RPOiByZW1vdmUuIGl0J3MgZm9yIGRlYnVnZ2luZyBjb2xvcnNcbiAgXCJnbF9Qb3NpdGlvbiA9IGN1cnJlbnRQcm9qZWN0ZWQgKyB2ZWM0KG9mZnNldCwgMC4wLDAuMCkgKmN1cnJlbnRQcm9qZWN0ZWQudztcIixcblwifVwiXS5qb2luKFwiXFxuXCIpO1xuXG52YXIgZlNoYWRlciA9IFtcblwidW5pZm9ybSBmbG9hdCBvcGFjaXR5O1wiLFxuXCJ1bmlmb3JtIHZlYzIgc2NyZWVuU2l6ZTtcIixcblwidW5pZm9ybSBmbG9hdCBhc3BlY3Q7XCIsXG5cInVuaWZvcm0gZmxvYXQgbGluZUpvaW5UeXBlO1wiLFxuXCJ2YXJ5aW5nIHZlYzMgdkNvbG9yO1wiLFxuXCJ2YXJ5aW5nIHZlYzMgZGVidWdJbmZvO1wiLFxuXCJ2YXJ5aW5nIHZlYzIgbGluZVNlZ21lbnRBQ2xpcFNwYWNlO1wiLFxuXCJ2YXJ5aW5nIHZlYzIgbGluZVNlZ21lbnRCQ2xpcFNwYWNlO1wiLFxuXCJ2YXJ5aW5nIGZsb2F0IGNyb3NzTGluZVBvc2l0aW9uO1wiLFxuXCJ2YXJ5aW5nIGZsb2F0IHRoaWNrbmVzcztcIixcblxuLyogdXNlZnVsIGZvciBkZWJ1Z2dpbmchIGZyb20gaHR0cHM6Ly93d3cucm9uamEtdHV0b3JpYWxzLmNvbS8yMDE4LzExLzI0L3NkZi1zcGFjZS1tYW5pcHVsYXRpb24uaHRtbFxuXCJ2ZWMzIHJlbmRlckxpbmVzT3V0c2lkZShmbG9hdCBkaXN0KXtcIixcblwiICAgIGZsb2F0IF9MaW5lRGlzdGFuY2UgPSAwLjM7XCIsXG5cIiAgICBmbG9hdCBfTGluZVRoaWNrbmVzcyA9IDAuMDU7XCIsXG5cIiAgICBmbG9hdCBfU3ViTGluZVRoaWNrbmVzcyA9IDAuMDU7XCIsXG5cIiAgICBmbG9hdCBfU3ViTGluZXMgPSAxLjA7XCIsXG5cIiAgICB2ZWMzIGNvbCA9IG1peCh2ZWMzKDEuMCwwLjIsMC4yKSwgdmVjMygwLjAsMC4yLDEuMiksIHN0ZXAoMC4wLCBkaXN0KSk7XCIsXG5cblwiICAgIGZsb2F0IGRpc3RhbmNlQ2hhbmdlID0gZndpZHRoKGRpc3QpICogMC41O1wiLFxuXCIgICAgZmxvYXQgbWFqb3JMaW5lRGlzdGFuY2UgPSBhYnMoZnJhY3QoZGlzdCAvIF9MaW5lRGlzdGFuY2UgKyAwLjUpIC0gMC41KSAqIF9MaW5lRGlzdGFuY2U7XCIsXG5cIiAgICBmbG9hdCBtYWpvckxpbmVzID0gc21vb3Roc3RlcChfTGluZVRoaWNrbmVzcyAtIGRpc3RhbmNlQ2hhbmdlLCBfTGluZVRoaWNrbmVzcyArIGRpc3RhbmNlQ2hhbmdlLCBtYWpvckxpbmVEaXN0YW5jZSk7XCIsXG5cblwiICAgIGZsb2F0IGRpc3RhbmNlQmV0d2VlblN1YkxpbmVzID0gX0xpbmVEaXN0YW5jZSAvIF9TdWJMaW5lcztcIixcblwiICAgIGZsb2F0IHN1YkxpbmVEaXN0YW5jZSA9IGFicyhmcmFjdChkaXN0IC8gZGlzdGFuY2VCZXR3ZWVuU3ViTGluZXMgKyAwLjUpIC0gMC41KSAqIGRpc3RhbmNlQmV0d2VlblN1YkxpbmVzO1wiLFxuXCIgICAgZmxvYXQgc3ViTGluZXMgPSBzbW9vdGhzdGVwKF9TdWJMaW5lVGhpY2tuZXNzIC0gZGlzdGFuY2VDaGFuZ2UsIF9TdWJMaW5lVGhpY2tuZXNzICsgZGlzdGFuY2VDaGFuZ2UsIHN1YkxpbmVEaXN0YW5jZSk7XCIsXG5cblwiICAgIHJldHVybiBjb2wgKiBtYWpvckxpbmVzICogc3ViTGluZXM7XCIsXG5cIn1cIiwgKi9cblxuXG5cImZsb2F0IGxpbmVTREYodmVjMiBwb2ludCwgdmVjMiBsaW5lU3RhcnRQdCx2ZWMyIGxpbmVFbmRQdCkge1wiLFxuICBcImZsb2F0IGggPSBjbGFtcChkb3QocG9pbnQtbGluZVN0YXJ0UHQsbGluZUVuZFB0LWxpbmVTdGFydFB0KS9kb3QobGluZUVuZFB0LWxpbmVTdGFydFB0LGxpbmVFbmRQdC1saW5lU3RhcnRQdCksMC4wLDEuMCk7XCIsXG4gIFwidmVjMiBwcm9qZWN0ZWRWZWMgPSAocG9pbnQtbGluZVN0YXJ0UHQtKGxpbmVFbmRQdC1saW5lU3RhcnRQdCkqaCk7XCIsXG4gIFwicmV0dXJuIGxlbmd0aChwcm9qZWN0ZWRWZWMpO1wiLFxuXCJ9XCIsXG5cblxuXCJ2b2lkIG1haW4oKXtcIixcblwiICB2ZWMzIGNvbCA9IHZDb2xvci5yZ2I7XCIsXG4vL1wiICBjb2wgPSBkZWJ1Z0luZm8ucmdiO1wiLFxuXCIgIGdsX0ZyYWdDb2xvciA9IHZlYzQoY29sLCBvcGFjaXR5KTtcIixcblxuXCIgIGlmIChsaW5lSm9pblR5cGUgPT0gXCIrTElORV9KT0lOX1RZUEVTLlJPVU5EK1wiKXtcIixcblwiICAgICAgdmVjMiB2ZXJ0U2NyZWVuU3BhY2VQb3NpdGlvbiA9IGdsX0ZyYWdDb29yZC54eTtcIiwgLy9nb2VzIGZyb20gMCB0byBzY3JlZW5TaXplLnh5XG5cIiAgICAgIHZlYzIgbGluZVB0QVNjcmVlblNwYWNlID0gKGxpbmVTZWdtZW50QUNsaXBTcGFjZSsxLikvMi4gKiBzY3JlZW5TaXplO1wiLCAvL2NvbnZlcnQgWy0xLDFdIHRvIFswLDFdLCB0aGVuICpzY3JlZW5TaXplXG5cIiAgICAgIHZlYzIgbGluZVB0QlNjcmVlblNwYWNlID0gKGxpbmVTZWdtZW50QkNsaXBTcGFjZSsxLikvMi4gKiBzY3JlZW5TaXplO1wiLFxuXCIgICAgICBmbG9hdCBkaXN0RnJvbUxpbmUgPSBsaW5lU0RGKHZlcnRTY3JlZW5TcGFjZVBvc2l0aW9uLCBsaW5lUHRBU2NyZWVuU3BhY2UsbGluZVB0QlNjcmVlblNwYWNlKTtcIixcblwiICAgICAgZmxvYXQgc2RmID0gMS4tKDEuL3RoaWNrbmVzcyAvc2NyZWVuU2l6ZS55ICogNC4wICpkaXN0RnJvbUxpbmUpO1wiLFxuXCIgICAgICBmbG9hdCBzZGZPcGFjaXR5ID0gY2xhbXAoc2RmIC8gKGFicyhkRmR4KHNkZikpICsgYWJzKGRGZHkoc2RmKSkpLDAuMCwxLjApO1wiLFxuXCIgICAgICBnbF9GcmFnQ29sb3IgPSB2ZWM0KGNvbCwgb3BhY2l0eSAqIHNkZk9wYWNpdHkgKTtcIixcblwiICB9XCIsXG5cIn1cIl0uam9pbihcIlxcblwiKVxuXG52YXIgdW5pZm9ybXMgPSB7XG5cdGxpbmVXaWR0aDoge1xuXHRcdHR5cGU6ICdmJyxcblx0XHR2YWx1ZTogMS4wLCAvL2N1cnJlbnRseSBpbiB1bml0cyBvZiB5SGVpZ2h0KjQwMFxuXHR9LFxuXHRzY3JlZW5TaXplOiB7XG5cdFx0dmFsdWU6IG5ldyBUSFJFRS5WZWN0b3IyKCAxLCAxICksXG5cdH0sXG5cdGxpbmVKb2luVHlwZToge1xuXHRcdHR5cGU6ICdmJyxcblx0XHR2YWx1ZTogTElORV9KT0lOX1RZUEVTLlJPVU5ELFxuXHR9LFxuXHRvcGFjaXR5OiB7XG5cdFx0dHlwZTogJ2YnLFxuXHRcdHZhbHVlOiAxLjAsXG5cdH0sXG5cdGFzcGVjdDogeyAvL2FzcGVjdCByYXRpby4gbmVlZCB0byBsb2FkIGZyb20gcmVuZGVyZXJcblx0XHR0eXBlOiAnZicsXG5cdFx0dmFsdWU6IDEuMCxcblx0fVxufTtcblxuZXhwb3J0IHsgdlNoYWRlciwgZlNoYWRlciwgdW5pZm9ybXMsIExJTkVfSk9JTl9UWVBFUyB9O1xuIiwiaW1wb3J0IHtPdXRwdXROb2RlfSBmcm9tICcuLi9Ob2RlLmpzJztcbmltcG9ydCB7IGdldFRocmVlRW52aXJvbm1lbnQgfSBmcm9tICcuLi9UaHJlZUVudmlyb25tZW50LmpzJztcbmltcG9ydCB7IHZTaGFkZXIsIGZTaGFkZXIsIHVuaWZvcm1zLCBMSU5FX0pPSU5fVFlQRVMgfSBmcm9tICcuL0xpbmVPdXRwdXRTaGFkZXJzLmpzJztcblxuY2xhc3MgTGluZU91dHB1dCBleHRlbmRzIE91dHB1dE5vZGV7XG4gICAgY29uc3RydWN0b3Iob3B0aW9ucyA9IHt9KXtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgLyogc2hvdWxkIGJlIC5hZGQoKWVkIHRvIGEgVHJhbnNmb3JtYXRpb24gdG8gd29yay5cbiAgICAgICAgQ3Jpc3AgbGluZXMgdXNpbmcgdGhlIHRlY2huaXF1ZSBpbiBodHRwczovL21hdHRkZXNsLnN2YnRsZS5jb20vZHJhd2luZy1saW5lcy1pcy1oYXJkLCBidXQgYWxzbyBzdXBwb3J0aW5nIG1pdGVyZWQgbGluZXMgYW5kIGJldmVsZWQgbGluZXMgdG9vIVxuICAgICAgICAgICAgb3B0aW9uczpcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICB3aWR0aDogbnVtYmVyLiB1bml0cyBhcmUgaW4gc2NyZWVuWS80MDAuXG4gICAgICAgICAgICAgICAgb3BhY2l0eTogbnVtYmVyXG4gICAgICAgICAgICAgICAgY29sb3I6IGhleCBjb2RlIG9yIFRIUkVFLkNvbG9yKClcbiAgICAgICAgICAgICAgICBsaW5lSm9pbjogXCJiZXZlbFwiIG9yIFwicm91bmRcIi4gZGVmYXVsdDogcm91bmQuIERvbid0IGNoYW5nZSB0aGlzIGFmdGVyIGluaXRpYWxpemF0aW9uLlxuICAgICAgICAgICAgfVxuICAgICAgICAqL1xuXG4gICAgICAgIHRoaXMuX3dpZHRoID0gb3B0aW9ucy53aWR0aCAhPT0gdW5kZWZpbmVkID8gb3B0aW9ucy53aWR0aCA6IDU7XG4gICAgICAgIHRoaXMuX29wYWNpdHkgPSBvcHRpb25zLm9wYWNpdHkgIT09IHVuZGVmaW5lZCA/IG9wdGlvbnMub3BhY2l0eSA6IDE7XG4gICAgICAgIHRoaXMuX2NvbG9yID0gb3B0aW9ucy5jb2xvciAhPT0gdW5kZWZpbmVkID8gbmV3IFRIUkVFLkNvbG9yKG9wdGlvbnMuY29sb3IpIDogbmV3IFRIUkVFLkNvbG9yKDB4NTVhYTU1KTtcblxuICAgICAgICB0aGlzLmxpbmVKb2luVHlwZSA9IG9wdGlvbnMubGluZUpvaW5UeXBlICE9PSB1bmRlZmluZWQgPyBvcHRpb25zLmxpbmVKb2luVHlwZS50b1VwcGVyQ2FzZSgpIDogXCJST1VORFwiO1xuICAgICAgICBpZihMSU5FX0pPSU5fVFlQRVNbdGhpcy5saW5lSm9pblR5cGVdID09PSB1bmRlZmluZWQpe1xuICAgICAgICAgICAgdGhpcy5saW5lSm9pblR5cGUgPSBcIlJPVU5EXCI7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLm51bUNhbGxzUGVyQWN0aXZhdGlvbiA9IDA7IC8vc2hvdWxkIGFsd2F5cyBiZSBlcXVhbCB0byB0aGlzLnBvaW50cy5sZW5ndGhcbiAgICAgICAgdGhpcy5pdGVtRGltZW5zaW9ucyA9IFtdOyAvLyBob3cgbWFueSB0aW1lcyB0byBiZSBjYWxsZWQgaW4gZWFjaCBkaXJlY3Rpb25cbiAgICAgICAgdGhpcy5fb3V0cHV0RGltZW5zaW9ucyA9IDM7IC8vaG93IG1hbnkgZGltZW5zaW9ucyBwZXIgcG9pbnQgdG8gc3RvcmU/XG5cbiAgICAgICAgdGhpcy5pbml0KCk7XG4gICAgfVxuICAgIGluaXQoKXtcbiAgICAgICAgdGhpcy5fZ2VvbWV0cnkgPSBuZXcgVEhSRUUuQnVmZmVyR2VvbWV0cnkoKTtcbiAgICAgICAgdGhpcy5fdmVydGljZXM7XG4gICAgICAgIHRoaXMubWFrZUdlb21ldHJ5KCk7XG5cblxuICAgICAgICAvL21ha2UgYSBkZWVwIGNvcHkgb2YgdGhlIHVuaWZvcm1zIHRlbXBsYXRlXG4gICAgICAgIHRoaXMuX3VuaWZvcm1zID0ge307XG4gICAgICAgIGZvcih2YXIgdW5pZm9ybU5hbWUgaW4gdW5pZm9ybXMpe1xuICAgICAgICAgICAgdGhpcy5fdW5pZm9ybXNbdW5pZm9ybU5hbWVdID0ge1xuICAgICAgICAgICAgICAgIHR5cGU6IHVuaWZvcm1zW3VuaWZvcm1OYW1lXS50eXBlLFxuICAgICAgICAgICAgICAgIHZhbHVlOiB1bmlmb3Jtc1t1bmlmb3JtTmFtZV0udmFsdWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubWF0ZXJpYWwgPSBuZXcgVEhSRUUuU2hhZGVyTWF0ZXJpYWwoe1xuICAgICAgICAgICAgc2lkZTogVEhSRUUuQmFja1NpZGUsXG4gICAgICAgICAgICB2ZXJ0ZXhTaGFkZXI6IHZTaGFkZXIsIFxuICAgICAgICAgICAgZnJhZ21lbnRTaGFkZXI6IGZTaGFkZXIsXG4gICAgICAgICAgICB1bmlmb3JtczogdGhpcy5fdW5pZm9ybXMsXG4gICAgICAgICAgICBleHRlbnNpb25zOntkZXJpdmF0aXZlczogdHJ1ZSx9LFxuICAgICAgICAgICAgdHJhbnNwYXJlbnQ6dHJ1ZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5tZXNoID0gbmV3IFRIUkVFLk1lc2godGhpcy5fZ2VvbWV0cnksdGhpcy5tYXRlcmlhbCk7XG5cbiAgICAgICAgdGhpcy5vcGFjaXR5ID0gdGhpcy5fb3BhY2l0eTsgLy8gc2V0dGVyIHNldHMgdHJhbnNwYXJlbnQgZmxhZyBpZiBuZWNlc3NhcnlcbiAgICAgICAgdGhpcy5jb2xvciA9IHRoaXMuX2NvbG9yOyAvL3NldHRlciBzZXRzIGNvbG9yIGF0dHJpYnV0ZVxuICAgICAgICB0aGlzLl91bmlmb3Jtcy5vcGFjaXR5LnZhbHVlID0gdGhpcy5fb3BhY2l0eTtcbiAgICAgICAgdGhpcy5fdW5pZm9ybXMubGluZVdpZHRoLnZhbHVlID0gdGhpcy5fd2lkdGg7XG4gICAgICAgIHRoaXMuX3VuaWZvcm1zLmxpbmVKb2luVHlwZS52YWx1ZSA9IExJTkVfSk9JTl9UWVBFU1t0aGlzLmxpbmVKb2luVHlwZV07XG5cbiAgICAgICAgZ2V0VGhyZWVFbnZpcm9ubWVudCgpLnNjZW5lLmFkZCh0aGlzLm1lc2gpO1xuICAgIH1cblxuICAgIG1ha2VHZW9tZXRyeSgpe1xuICAgICAgICBjb25zdCBNQVhfUE9JTlRTID0gMTAwMDsgLy90aGVzZSBhcnJheXMgZ2V0IGRpc2NhcmRlZCBvbiBmaXJzdCBhY3RpdmF0aW9uIGFueXdheXNcbiAgICAgICAgY29uc3QgTlVNX1BPSU5UU19QRVJfVkVSVEVYID0gNDtcblxuICAgICAgICBsZXQgbnVtVmVydHMgPSAoTUFYX1BPSU5UUy0xKSpOVU1fUE9JTlRTX1BFUl9WRVJURVg7XG5cbiAgICAgICAgdGhpcy5fdmVydGljZXMgPSBuZXcgRmxvYXQzMkFycmF5KHRoaXMuX291dHB1dERpbWVuc2lvbnMgKiBudW1WZXJ0cyk7XG4gICAgICAgIHRoaXMuX25leHRQb2ludFZlcnRpY2VzID0gbmV3IEZsb2F0MzJBcnJheSh0aGlzLl9vdXRwdXREaW1lbnNpb25zICogbnVtVmVydHMpO1xuICAgICAgICB0aGlzLl9wcmV2UG9pbnRWZXJ0aWNlcyA9IG5ldyBGbG9hdDMyQXJyYXkodGhpcy5fb3V0cHV0RGltZW5zaW9ucyAqIG51bVZlcnRzKTtcbiAgICAgICAgdGhpcy5fY29sb3JzID0gbmV3IEZsb2F0MzJBcnJheShudW1WZXJ0cyAqIDMpO1xuXG4gICAgICAgIC8vIGJ1aWxkIGdlb21ldHJ5XG5cbiAgICAgICAgdGhpcy5fZ2VvbWV0cnkuYWRkQXR0cmlidXRlKCAncG9zaXRpb24nLCBuZXcgVEhSRUUuRmxvYXQzMkJ1ZmZlckF0dHJpYnV0ZSggdGhpcy5fdmVydGljZXMsIHRoaXMuX291dHB1dERpbWVuc2lvbnMgKSApO1xuICAgICAgICB0aGlzLl9nZW9tZXRyeS5hZGRBdHRyaWJ1dGUoICduZXh0UG9pbnRQb3NpdGlvbicsIG5ldyBUSFJFRS5GbG9hdDMyQnVmZmVyQXR0cmlidXRlKCB0aGlzLl9uZXh0UG9pbnRWZXJ0aWNlcywgdGhpcy5fb3V0cHV0RGltZW5zaW9ucyApICk7XG4gICAgICAgIHRoaXMuX2dlb21ldHJ5LmFkZEF0dHJpYnV0ZSggJ3ByZXZpb3VzUG9pbnRQb3NpdGlvbicsIG5ldyBUSFJFRS5GbG9hdDMyQnVmZmVyQXR0cmlidXRlKCB0aGlzLl9wcmV2UG9pbnRWZXJ0aWNlcywgdGhpcy5fb3V0cHV0RGltZW5zaW9ucyApICk7XG4gICAgICAgIHRoaXMuX2dlb21ldHJ5LmFkZEF0dHJpYnV0ZSggJ2NvbG9yJywgbmV3IFRIUkVFLkZsb2F0MzJCdWZmZXJBdHRyaWJ1dGUoIHRoaXMuX2NvbG9ycywgMyApICk7XG5cbiAgICAgICAgdGhpcy5fY3VycmVudFBvaW50SW5kZXggPSAwOyAvL3VzZWQgZHVyaW5nIHVwZGF0ZXMgYXMgYSBwb2ludGVyIHRvIHRoZSBidWZmZXJcbiAgICAgICAgdGhpcy5fYWN0aXZhdGVkT25jZSA9IGZhbHNlO1xuXG4gICAgfVxuICAgIF9vbkFkZCgpe1xuICAgICAgICAvL2NsaW1iIHVwIHBhcmVudCBoaWVyYXJjaHkgdG8gZmluZCB0aGUgRG9tYWluIG5vZGUgd2UncmUgcmVuZGVyaW5nIGZyb21cbiAgICAgICAgbGV0IHJvb3QgPSBudWxsO1xuICAgICAgICB0cnl7XG4gICAgICAgICAgIHJvb3QgPSB0aGlzLmdldENsb3Nlc3REb21haW4oKTtcbiAgICAgICAgfWNhdGNoKGVycm9yKXtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihlcnJvcik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICBcbiAgICAgICAgLy90b2RvOiBpbXBsZW1lbnQgc29tZXRoaW5nIGxpa2UgYXNzZXJ0IHJvb3QgdHlwZW9mIFJvb3ROb2RlXG5cbiAgICAgICAgdGhpcy5udW1DYWxsc1BlckFjdGl2YXRpb24gPSByb290Lm51bUNhbGxzUGVyQWN0aXZhdGlvbjtcbiAgICAgICAgdGhpcy5pdGVtRGltZW5zaW9ucyA9IHJvb3QuaXRlbURpbWVuc2lvbnM7XG4gICAgfVxuICAgIF9vbkZpcnN0QWN0aXZhdGlvbigpe1xuICAgICAgICB0aGlzLl9vbkFkZCgpOyAvL3NldHVwIHRoaXMubnVtQ2FsbHNQZXJBY3RpdmF0aW9uIGFuZCB0aGlzLml0ZW1EaW1lbnNpb25zLiB1c2VkIGhlcmUgYWdhaW4gYmVjYXVzZSBjbG9uaW5nIG1lYW5zIHRoZSBvbkFkZCgpIG1pZ2h0IGJlIGNhbGxlZCBiZWZvcmUgdGhpcyBpcyBjb25uZWN0ZWQgdG8gYSB0eXBlIG9mIGRvbWFpblxuXG4gICAgICAgIC8vIHBlcmhhcHMgaW5zdGVhZCBvZiBnZW5lcmF0aW5nIGEgd2hvbGUgbmV3IGFycmF5LCB0aGlzIGNhbiByZXVzZSB0aGUgb2xkIG9uZT9cblxuICAgICAgICBjb25zdCBOVU1fUE9JTlRTX1BFUl9MSU5FX1NFR01FTlQgPSA0OyAvLzQgdXNlZCBmb3IgYmV2ZWxpbmdcbiAgICAgICAgY29uc3QgbnVtVmVydHMgPSAodGhpcy5udW1DYWxsc1BlckFjdGl2YXRpb24pICogTlVNX1BPSU5UU19QRVJfTElORV9TRUdNRU5UO1xuXG4gICAgICAgIGxldCB2ZXJ0aWNlcyA9IG5ldyBGbG9hdDMyQXJyYXkoIHRoaXMuX291dHB1dERpbWVuc2lvbnMgKiBudW1WZXJ0cyk7XG4gICAgICAgIGxldCBuZXh0VmVydGljZXMgPSBuZXcgRmxvYXQzMkFycmF5KCB0aGlzLl9vdXRwdXREaW1lbnNpb25zICogbnVtVmVydHMpO1xuICAgICAgICBsZXQgcHJldlZlcnRpY2VzID0gbmV3IEZsb2F0MzJBcnJheSggdGhpcy5fb3V0cHV0RGltZW5zaW9ucyAqIG51bVZlcnRzKTtcbiAgICAgICAgbGV0IGNvbG9ycyA9IG5ldyBGbG9hdDMyQXJyYXkoIDMgKiBudW1WZXJ0cyk7XG5cbiAgICAgICAgbGV0IHBvc2l0aW9uQXR0cmlidXRlID0gdGhpcy5fZ2VvbWV0cnkuYXR0cmlidXRlcy5wb3NpdGlvbjtcbiAgICAgICAgdGhpcy5fdmVydGljZXMgPSB2ZXJ0aWNlcztcbiAgICAgICAgcG9zaXRpb25BdHRyaWJ1dGUuc2V0QXJyYXkodGhpcy5fdmVydGljZXMpO1xuXG4gICAgICAgIGxldCBwcmV2UG9pbnRQb3NpdGlvbkF0dHJpYnV0ZSA9IHRoaXMuX2dlb21ldHJ5LmF0dHJpYnV0ZXMucHJldmlvdXNQb2ludFBvc2l0aW9uO1xuICAgICAgICB0aGlzLl9wcmV2UG9pbnRWZXJ0aWNlcyA9IHByZXZWZXJ0aWNlcztcbiAgICAgICAgcHJldlBvaW50UG9zaXRpb25BdHRyaWJ1dGUuc2V0QXJyYXkodGhpcy5fcHJldlBvaW50VmVydGljZXMpO1xuXG4gICAgICAgIGxldCBuZXh0UG9pbnRQb3NpdGlvbkF0dHJpYnV0ZSA9IHRoaXMuX2dlb21ldHJ5LmF0dHJpYnV0ZXMubmV4dFBvaW50UG9zaXRpb247XG4gICAgICAgIHRoaXMuX25leHRQb2ludFZlcnRpY2VzID0gbmV4dFZlcnRpY2VzO1xuICAgICAgICBuZXh0UG9pbnRQb3NpdGlvbkF0dHJpYnV0ZS5zZXRBcnJheSh0aGlzLl9uZXh0UG9pbnRWZXJ0aWNlcyk7XG5cbiAgICAgICAgbGV0IGNvbG9yQXR0cmlidXRlID0gdGhpcy5fZ2VvbWV0cnkuYXR0cmlidXRlcy5jb2xvcjtcbiAgICAgICAgdGhpcy5fY29sb3JzID0gY29sb3JzO1xuICAgICAgICBjb2xvckF0dHJpYnV0ZS5zZXRBcnJheSh0aGlzLl9jb2xvcnMpO1xuXG4gICAgICAgIC8vdXNlZCB0byBkaWZmZXJlbnRpYXRlIHRoZSBsZWZ0IGJvcmRlciBvZiB0aGUgbGluZSBmcm9tIHRoZSByaWdodCBib3JkZXJcbiAgICAgICAgbGV0IGRpcmVjdGlvbiA9IG5ldyBGbG9hdDMyQXJyYXkobnVtVmVydHMpO1xuICAgICAgICBmb3IobGV0IGk9MDsgaTxudW1WZXJ0cztpKyspe1xuICAgICAgICAgICAgZGlyZWN0aW9uW2ldID0gaSUyPT0wID8gMSA6IDA7IC8vYWx0ZXJuYXRlIC0xIGFuZCAxXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fZ2VvbWV0cnkuYWRkQXR0cmlidXRlKCAnZGlyZWN0aW9uJywgbmV3IFRIUkVFLkZsb2F0MzJCdWZmZXJBdHRyaWJ1dGUoIGRpcmVjdGlvbiwgMSkgKTtcblxuICAgICAgICAvL3VzZWQgdG8gZGlmZmVyZW50aWF0ZSB0aGUgcG9pbnRzIHdoaWNoIG1vdmUgdG93YXJkcyBwcmV2IHZlcnRleCBmcm9tIHBvaW50cyB3aGljaCBtb3ZlIHRvd2FyZHMgbmV4dCB2ZXJ0ZXhcbiAgICAgICAgbGV0IG5leHRPclByZXYgPSBuZXcgRmxvYXQzMkFycmF5KG51bVZlcnRzKTtcbiAgICAgICAgZm9yKGxldCBpPTA7IGk8bnVtVmVydHM7aSsrKXtcbiAgICAgICAgICAgIG5leHRPclByZXZbaV0gPSBpJTQ8MiA/IDAgOiAxOyAvL2FsdGVybmF0ZSAwLDAsIDEsMVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2dlb21ldHJ5LmFkZEF0dHJpYnV0ZSggJ2FwcHJvYWNoTmV4dE9yUHJldlZlcnRleCcsIG5ldyBUSFJFRS5GbG9hdDMyQnVmZmVyQXR0cmlidXRlKCBuZXh0T3JQcmV2LCAxKSApO1xuXG4gICAgICAgIC8vaW5kaWNlc1xuICAgICAgICAvKlxuICAgICAgICBGb3IgZWFjaCB2ZXJ0ZXgsIHdlIGNvbm5lY3QgaXQgdG8gdGhlIG5leHQgdmVydGV4IGxpa2UgdGhpczpcbiAgICAgICAgbiAtLW4rMi0tbis0LS1uKzZcbiAgICAgICAgfCAgLyAgfCAvIHwgIC8gIHxcbiAgICAgICBuKzEgLS1uKzMtLW4rNS0tbis3XG5cbiAgICAgICBwdDEgICBwdDIgcHQyICAgcHQzXG5cbiAgICAgICB2ZXJ0aWNlcyBuLG4rMSBhcmUgYXJvdW5kIHBvaW50IDEsIG4rMixuKzMsbis0LG4rNSBhcmUgYXJvdW5kIHB0Miwgbis2LG4rNyBhcmUgZm9yIHBvaW50My4gdGhlIG1pZGRsZSBzZWdtZW50IChuKzItbis1KSBpcyB0aGUgcG9seWdvbiB1c2VkIGZvciBiZXZlbGluZyBhdCBwb2ludCAyLlxuXG4gICAgICAgIHRoZW4gd2UgYWR2YW5jZSBuIHR3byBhdCBhIHRpbWUgdG8gbW92ZSB0byB0aGUgbmV4dCB2ZXJ0ZXguIHZlcnRpY2VzIG4sIG4rMSByZXByZXNlbnQgdGhlIHNhbWUgcG9pbnQ7XG4gICAgICAgIHRoZXkncmUgc2VwYXJhdGVkIGluIHRoZSB2ZXJ0ZXggc2hhZGVyIHRvIGEgY29uc3RhbnQgc2NyZWVuc3BhY2Ugd2lkdGggKi9cbiAgICAgICAgbGV0IGluZGljZXMgPSBbXTtcbiAgICAgICAgZm9yKGxldCB2ZXJ0TnVtPTA7dmVydE51bTwodGhpcy5udW1DYWxsc1BlckFjdGl2YXRpb24tMSk7dmVydE51bSArPTEpeyAvL25vdCBzdXJlIHdoeSB0aGlzIC0zIGlzIHRoZXJlLiBpIGd1ZXNzIGl0IHN0b3BzIHZlcnROdW0rMyB0d28gbGluZXMgZG93biBmcm9tIGdvaW5nIHNvbWV3aGVyZSBpdCBzaG91bGRuJ3Q/XG4gICAgICAgICAgICBsZXQgZmlyc3RDb29yZGluYXRlID0gdmVydE51bSAlIHRoaXMuaXRlbURpbWVuc2lvbnNbdGhpcy5pdGVtRGltZW5zaW9ucy5sZW5ndGgtMV07XG4gICAgICAgICAgICBsZXQgZW5kaW5nTmV3TGluZSA9IGZpcnN0Q29vcmRpbmF0ZSA9PSB0aGlzLml0ZW1EaW1lbnNpb25zW3RoaXMuaXRlbURpbWVuc2lvbnMubGVuZ3RoLTFdLTE7XG4gICAgXG4gICAgICAgICAgICBsZXQgdmVydEluZGV4ID0gdmVydE51bSAqIE5VTV9QT0lOVFNfUEVSX0xJTkVfU0VHTUVOVDtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYoIWVuZGluZ05ld0xpbmUpe1xuICAgICAgICAgICAgICAgIC8vdGhlc2UgdHJpYW5nbGVzIHNob3VsZCBiZSBkaXNhYmxlZCB3aGVuIGRvaW5nIHJvdW5kIGpvaW5zXG4gICAgICAgICAgICAgICAgaWYodGhpcy5saW5lSm9pblR5cGUgPT0gXCJCRVZFTFwiKXtcbiAgICAgICAgICAgICAgICAgICAgaW5kaWNlcy5wdXNoKCB2ZXJ0SW5kZXgrMSwgdmVydEluZGV4LCAgIHZlcnRJbmRleCsyKTtcbiAgICAgICAgICAgICAgICAgICAgaW5kaWNlcy5wdXNoKCB2ZXJ0SW5kZXgrMSwgdmVydEluZGV4KzIsIHZlcnRJbmRleCszKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpbmRpY2VzLnB1c2goIHZlcnRJbmRleCszLCB2ZXJ0SW5kZXgrMiwgdmVydEluZGV4KzQpO1xuICAgICAgICAgICAgICAgIGluZGljZXMucHVzaCggdmVydEluZGV4KzMsIHZlcnRJbmRleCs0LCB2ZXJ0SW5kZXgrNSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fZ2VvbWV0cnkuc2V0SW5kZXgoIGluZGljZXMgKTtcblxuICAgICAgICB0aGlzLnNldEFsbFZlcnRpY2VzVG9Db2xvcih0aGlzLmNvbG9yKTtcblxuICAgICAgICBwb3NpdGlvbkF0dHJpYnV0ZS5uZWVkc1VwZGF0ZSA9IHRydWU7XG4gICAgICAgIGNvbG9yQXR0cmlidXRlLm5lZWRzVXBkYXRlID0gdHJ1ZTtcbiAgICB9XG4gICAgZXZhbHVhdGVTZWxmKGksIHQsIHgsIHksIHope1xuICAgICAgICBpZighdGhpcy5fYWN0aXZhdGVkT25jZSl7XG4gICAgICAgICAgICB0aGlzLl9hY3RpdmF0ZWRPbmNlID0gdHJ1ZTtcbiAgICAgICAgICAgIHRoaXMuX29uRmlyc3RBY3RpdmF0aW9uKCk7ICAgIFxuICAgICAgICB9XG5cbiAgICAgICAgLy9pdCdzIGFzc3VtZWQgaSB3aWxsIGdvIGZyb20gMCB0byB0aGlzLm51bUNhbGxzUGVyQWN0aXZhdGlvbiwgc2luY2UgdGhpcyBzaG91bGQgb25seSBiZSBjYWxsZWQgZnJvbSBhbiBBcmVhLlxuXG4gICAgICAgIC8vYXNzZXJ0IGkgPCB2ZXJ0aWNlcy5jb3VudFxuXG4gICAgICAgIGxldCB4VmFsdWUgPSAgeCA9PT0gdW5kZWZpbmVkID8gMCA6IHg7XG4gICAgICAgIGxldCB5VmFsdWUgPSAgeSA9PT0gdW5kZWZpbmVkID8gMCA6IHk7XG4gICAgICAgIGxldCB6VmFsdWUgPSAgeiA9PT0gdW5kZWZpbmVkID8gMCA6IHo7XG5cbiAgICAgICAgdGhpcy5zYXZlVmVydGV4SW5mb0luQnVmZmVycyh0aGlzLl92ZXJ0aWNlcywgdGhpcy5fY3VycmVudFBvaW50SW5kZXgsIHhWYWx1ZSx5VmFsdWUselZhbHVlKTtcblxuICAgICAgICAvKiB3ZSdyZSBkcmF3aW5nIGxpa2UgdGhpczpcbiAgICAgICAgKi0tLS0qLS0tLSpcblxuICAgICAgICAqLS0tLSotLS0tKlxuICAgIFxuICAgICAgICBidXQgd2UgZG9uJ3Qgd2FudCB0byBpbnNlcnQgYSBkaWFnb25hbCBsaW5lIGFueXdoZXJlLiBUaGlzIGhhbmRsZXMgdGhhdDogICovXG5cbiAgICAgICAgbGV0IGZpcnN0Q29vcmRpbmF0ZSA9IGkgJSB0aGlzLml0ZW1EaW1lbnNpb25zW3RoaXMuaXRlbURpbWVuc2lvbnMubGVuZ3RoLTFdO1xuXG4gICAgICAgIC8vYm9vbGVhbiB2YXJpYWJsZXMuIGlmIGluIHRoZSBmdXR1cmUgTGluZU91dHB1dCBjYW4gc3VwcG9ydCB2YXJpYWJsZS13aWR0aCBsaW5lcywgdGhlc2Ugc2hvdWxkIGViIGNoYW5nZWRcbiAgICAgICAgbGV0IHN0YXJ0aW5nTmV3TGluZSA9IGZpcnN0Q29vcmRpbmF0ZSA9PSAwO1xuICAgICAgICBsZXQgZW5kaW5nTmV3TGluZSA9IGZpcnN0Q29vcmRpbmF0ZSA9PSB0aGlzLml0ZW1EaW1lbnNpb25zW3RoaXMuaXRlbURpbWVuc2lvbnMubGVuZ3RoLTFdLTE7XG5cbiAgICAgICAgaWYoc3RhcnRpbmdOZXdMaW5lKXtcbiAgICAgICAgICAgIC8vbWFrZSB0aGUgcHJldlBvaW50IGJlIHRoZSBzYW1lIHBvaW50IGFzIHRoaXNcbiAgICAgICAgICAgIHRoaXMuc2F2ZVZlcnRleEluZm9JbkJ1ZmZlcnModGhpcy5fcHJldlBvaW50VmVydGljZXMsIHRoaXMuX2N1cnJlbnRQb2ludEluZGV4LCB4VmFsdWUseVZhbHVlLHpWYWx1ZSk7XG4gICAgICAgIH1lbHNle1xuXG4gICAgICAgICAgICBsZXQgcHJldlggPSB0aGlzLl92ZXJ0aWNlc1sodGhpcy5fY3VycmVudFBvaW50SW5kZXgtMSkqdGhpcy5fb3V0cHV0RGltZW5zaW9ucyo0XTtcbiAgICAgICAgICAgIGxldCBwcmV2WSA9IHRoaXMuX3ZlcnRpY2VzWyh0aGlzLl9jdXJyZW50UG9pbnRJbmRleC0xKSp0aGlzLl9vdXRwdXREaW1lbnNpb25zKjQrMV07XG4gICAgICAgICAgICBsZXQgcHJldlogPSB0aGlzLl92ZXJ0aWNlc1sodGhpcy5fY3VycmVudFBvaW50SW5kZXgtMSkqdGhpcy5fb3V0cHV0RGltZW5zaW9ucyo0KzJdO1xuXG4gICAgICAgICAgICAvL3NldCB0aGlzIHRoaW5nJ3MgcHJldlBvaW50IHRvIHRoZSBwcmV2aW91cyB2ZXJ0ZXhcbiAgICAgICAgICAgIHRoaXMuc2F2ZVZlcnRleEluZm9JbkJ1ZmZlcnModGhpcy5fcHJldlBvaW50VmVydGljZXMsIHRoaXMuX2N1cnJlbnRQb2ludEluZGV4LCBwcmV2WCxwcmV2WSxwcmV2Wik7XG5cbiAgICAgICAgICAgIC8vc2V0IHRoZSBQUkVWSU9VUyBwb2ludCdzIG5leHRQb2ludCB0byB0byBUSElTIHZlcnRleC5cbiAgICAgICAgICAgIHRoaXMuc2F2ZVZlcnRleEluZm9JbkJ1ZmZlcnModGhpcy5fbmV4dFBvaW50VmVydGljZXMsIHRoaXMuX2N1cnJlbnRQb2ludEluZGV4LTEsIHhWYWx1ZSx5VmFsdWUselZhbHVlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGVuZGluZ05ld0xpbmUpe1xuICAgICAgICAgICAgLy9tYWtlIHRoZSBuZXh0UG9pbnQgYmUgdGhlIHNhbWUgcG9pbnQgYXMgdGhpc1xuICAgICAgICAgICAgdGhpcy5zYXZlVmVydGV4SW5mb0luQnVmZmVycyh0aGlzLl9uZXh0UG9pbnRWZXJ0aWNlcywgdGhpcy5fY3VycmVudFBvaW50SW5kZXgsIHhWYWx1ZSx5VmFsdWUselZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jdXJyZW50UG9pbnRJbmRleCsrO1xuICAgIH1cblxuICAgIHNhdmVWZXJ0ZXhJbmZvSW5CdWZmZXJzKGFycmF5LCB2ZXJ0TnVtLCB2YWx1ZTEsdmFsdWUyLHZhbHVlMyl7XG4gICAgICAgIC8vZm9yIGV2ZXJ5IGNhbGwgdG8gYWN0aXZhdGUoKSwgYWxsIDQgZ2VvbWV0cnkgdmVydGljZXMgcmVwcmVzZW50aW5nIHRoYXQgcG9pbnQgbmVlZCB0byBzYXZlIHRoYXQgaW5mby5cbiAgICAgICAgLy9UaGVyZWZvcmUsIHRoaXMgZnVuY3Rpb24gd2lsbCBzcHJlYWQgdGhyZWUgY29vcmRpbmF0ZXMgaW50byBhIGdpdmVuIGFycmF5LCByZXBlYXRlZGx5LlxuXG4gICAgICAgIGxldCBpbmRleCA9IHZlcnROdW0qdGhpcy5fb3V0cHV0RGltZW5zaW9ucyo0O1xuXG4gICAgICAgIGFycmF5W2luZGV4XSAgID0gdmFsdWUxXG4gICAgICAgIGFycmF5W2luZGV4KzFdID0gdmFsdWUyXG4gICAgICAgIGFycmF5W2luZGV4KzJdID0gdmFsdWUzXG5cbiAgICAgICAgYXJyYXlbaW5kZXgrM10gPSB2YWx1ZTFcbiAgICAgICAgYXJyYXlbaW5kZXgrNF0gPSB2YWx1ZTJcbiAgICAgICAgYXJyYXlbaW5kZXgrNV0gPSB2YWx1ZTNcblxuICAgICAgICBhcnJheVtpbmRleCs2XSA9IHZhbHVlMVxuICAgICAgICBhcnJheVtpbmRleCs3XSA9IHZhbHVlMlxuICAgICAgICBhcnJheVtpbmRleCs4XSA9IHZhbHVlM1xuXG4gICAgICAgIGFycmF5W2luZGV4KzldICA9IHZhbHVlMVxuICAgICAgICBhcnJheVtpbmRleCsxMF0gPSB2YWx1ZTJcbiAgICAgICAgYXJyYXlbaW5kZXgrMTFdID0gdmFsdWUzXG4gICAgICAgIFxuICAgIH1cbiAgICBvbkFmdGVyQWN0aXZhdGlvbigpe1xuICAgICAgICBsZXQgcG9zaXRpb25BdHRyaWJ1dGUgPSB0aGlzLl9nZW9tZXRyeS5hdHRyaWJ1dGVzLnBvc2l0aW9uO1xuICAgICAgICBwb3NpdGlvbkF0dHJpYnV0ZS5uZWVkc1VwZGF0ZSA9IHRydWU7XG4gICAgICAgIGxldCBwcmV2UG9pbnRQb3NpdGlvbkF0dHJpYnV0ZSA9IHRoaXMuX2dlb21ldHJ5LmF0dHJpYnV0ZXMucHJldmlvdXNQb2ludFBvc2l0aW9uO1xuICAgICAgICBwcmV2UG9pbnRQb3NpdGlvbkF0dHJpYnV0ZS5uZWVkc1VwZGF0ZSA9IHRydWU7XG4gICAgICAgIGxldCBuZXh0UG9pbnRQb3NpdGlvbkF0dHJpYnV0ZSA9IHRoaXMuX2dlb21ldHJ5LmF0dHJpYnV0ZXMubmV4dFBvaW50UG9zaXRpb247XG4gICAgICAgIG5leHRQb2ludFBvc2l0aW9uQXR0cmlidXRlLm5lZWRzVXBkYXRlID0gdHJ1ZTtcblxuICAgICAgICAvL3VwZGF0ZSBhc3BlY3QgcmF0aW8uIGluIHRoZSBmdXR1cmUgcGVyaGFwcyB0aGlzIHNob3VsZCBvbmx5IGJlIGNoYW5nZWQgd2hlbiB0aGUgYXNwZWN0IHJhdGlvIGNoYW5nZXMgc28gaXQncyBub3QgYmVpbmcgZG9uZSBwZXIgZnJhbWU/XG4gICAgICAgIGlmKHRoaXMuX3VuaWZvcm1zKXtcbiAgICAgICAgICAgIGNvbnN0IHRocmVlID0gZ2V0VGhyZWVFbnZpcm9ubWVudCgpO1xuICAgICAgICAgICAgdGhpcy5fdW5pZm9ybXMuYXNwZWN0LnZhbHVlID0gdGhyZWUuY2FtZXJhLmFzcGVjdDsgLy9UT0RPOiByZS1lbmFibGUgb25jZSBkZWJ1Z2dpbmcgaXMgZG9uZVxuICAgICAgICAgICAgdGhyZWUucmVuZGVyZXIuZ2V0RHJhd2luZ0J1ZmZlclNpemUodGhpcy5fdW5pZm9ybXMuc2NyZWVuU2l6ZS52YWx1ZSk7IC8vbW9kaWZpZXMgdW5pZm9ybSBpbiBwbGFjZVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5fY3VycmVudFBvaW50SW5kZXggPSAwOyAvL3Jlc2V0IGFmdGVyIGVhY2ggdXBkYXRlXG4gICAgfVxuICAgIHJlbW92ZVNlbGZGcm9tU2NlbmUoKXtcbiAgICAgICAgZ2V0VGhyZWVFbnZpcm9ubWVudCgpLnNjZW5lLnJlbW92ZSh0aGlzLm1lc2gpO1xuICAgIH1cbiAgICBzZXRBbGxWZXJ0aWNlc1RvQ29sb3IoY29sb3Ipe1xuICAgICAgICBjb25zdCBjb2wgPSBuZXcgVEhSRUUuQ29sb3IoY29sb3IpO1xuICAgICAgICBjb25zdCBudW1WZXJ0aWNlcyA9ICh0aGlzLm51bUNhbGxzUGVyQWN0aXZhdGlvbi0xKSoyO1xuICAgICAgICBmb3IobGV0IGk9MDsgaTxudW1WZXJ0aWNlcztpKyspe1xuICAgICAgICAgICAgLy9Eb24ndCBmb3JnZXQgc29tZSBwb2ludHMgYXBwZWFyIHR3aWNlIC0gYXMgdGhlIGVuZCBvZiBvbmUgbGluZSBzZWdtZW50IGFuZCB0aGUgYmVnaW5uaW5nIG9mIHRoZSBuZXh0LlxuICAgICAgICAgICAgdGhpcy5fc2V0Q29sb3JGb3JWZXJ0ZXhSR0IoaSwgY29sLnIsIGNvbC5nLCBjb2wuYik7XG4gICAgICAgIH1cbiAgICAgICAgLy90ZWxsIHRocmVlLmpzIHRvIHVwZGF0ZSBjb2xvcnNcbiAgICB9XG4gICAgX3NldENvbG9yRm9yVmVydGV4KHZlcnRleEluZGV4LCBjb2xvcil7XG4gICAgICAgIC8vY29sb3IgaXMgYSBUSFJFRS5Db2xvciBoZXJlXG4gICAgICAgIHRoaXMuX3NldENvbG9yRm9yVmVydGV4UkdCKHZlcnRleEluZGV4LCBjb2xvci5yLCBjb2xvci5nLCBjb2xvci5iKTtcbiAgICB9XG4gICAgX3NldENvbG9yRm9yVmVydGV4UkdCKHZlcnRleEluZGV4LCBub3JtYWxpemVkUiwgbm9ybWFsaXplZEcsIG5vcm1hbGl6ZWRCKXtcbiAgICAgICAgLy9hbGwgb2Ygbm9ybWFsaXplZFIsIG5vcm1hbGl6ZWRHLCBub3JtYWxpemVkQiBhcmUgMC0xLlxuICAgICAgICBsZXQgY29sb3JBcnJheSA9IHRoaXMuX2dlb21ldHJ5LmF0dHJpYnV0ZXMuY29sb3IuYXJyYXk7XG4gICAgICAgIGxldCBpbmRleCA9IHZlcnRleEluZGV4ICogMyAqIDQ7IC8vKjMgYmVjYXVzZSBjb2xvcnMgaGF2ZSAzIGNoYW5uZWxzLCAqNCBiZWNhdXNlIDQgdmVydGljZXMvbGluZSBwb2ludFxuXG4gICAgICAgIGNvbG9yQXJyYXlbaW5kZXggKyAwXSA9IG5vcm1hbGl6ZWRSO1xuICAgICAgICBjb2xvckFycmF5W2luZGV4ICsgMV0gPSBub3JtYWxpemVkRztcbiAgICAgICAgY29sb3JBcnJheVtpbmRleCArIDJdID0gbm9ybWFsaXplZEI7XG5cbiAgICAgICAgY29sb3JBcnJheVtpbmRleCArIDNdID0gbm9ybWFsaXplZFI7XG4gICAgICAgIGNvbG9yQXJyYXlbaW5kZXggKyA0XSA9IG5vcm1hbGl6ZWRHO1xuICAgICAgICBjb2xvckFycmF5W2luZGV4ICsgNV0gPSBub3JtYWxpemVkQjtcblxuICAgICAgICBjb2xvckFycmF5W2luZGV4ICsgNl0gPSBub3JtYWxpemVkUjtcbiAgICAgICAgY29sb3JBcnJheVtpbmRleCArIDddID0gbm9ybWFsaXplZEc7XG4gICAgICAgIGNvbG9yQXJyYXlbaW5kZXggKyA4XSA9IG5vcm1hbGl6ZWRCO1xuXG4gICAgICAgIGNvbG9yQXJyYXlbaW5kZXggKyA5XSA9IG5vcm1hbGl6ZWRSO1xuICAgICAgICBjb2xvckFycmF5W2luZGV4ICsgMTBdID0gbm9ybWFsaXplZEc7XG4gICAgICAgIGNvbG9yQXJyYXlbaW5kZXggKyAxMV0gPSBub3JtYWxpemVkQjtcblxuICAgICAgICBsZXQgY29sb3JBdHRyaWJ1dGUgPSB0aGlzLl9nZW9tZXRyeS5hdHRyaWJ1dGVzLmNvbG9yO1xuICAgICAgICBjb2xvckF0dHJpYnV0ZS5uZWVkc1VwZGF0ZSA9IHRydWU7XG4gICAgfVxuICAgIHNldCBjb2xvcihjb2xvcil7XG4gICAgICAgIC8vY3VycmVudGx5IG9ubHkgYSBzaW5nbGUgY29sb3IgaXMgc3VwcG9ydGVkLlxuICAgICAgICAvL0kgc2hvdWxkIHJlYWxseSBtYWtlIGl0IHBvc3NpYmxlIHRvIHNwZWNpZnkgY29sb3IgYnkgYSBmdW5jdGlvbi5cbiAgICAgICAgdGhpcy5fY29sb3IgPSBjb2xvcjtcbiAgICAgICAgdGhpcy5zZXRBbGxWZXJ0aWNlc1RvQ29sb3IoY29sb3IpO1xuICAgIH1cbiAgICBnZXQgY29sb3IoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2NvbG9yO1xuICAgIH1cbiAgICBzZXQgb3BhY2l0eShvcGFjaXR5KXtcbiAgICAgICAgdGhpcy5tYXRlcmlhbC5vcGFjaXR5ID0gb3BhY2l0eTtcbiAgICAgICAgLy90aGlzLm1hdGVyaWFsLnRyYW5zcGFyZW50ID0gb3BhY2l0eSA8IDE7XG4gICAgICAgIHRoaXMubWF0ZXJpYWwudmlzaWJsZSA9IG9wYWNpdHkgPiAwO1xuICAgICAgICB0aGlzLl9vcGFjaXR5ID0gb3BhY2l0eTtcbiAgICAgICAgdGhpcy5fdW5pZm9ybXMub3BhY2l0eS52YWx1ZSA9IG9wYWNpdHk7XG4gICAgfVxuICAgIGdldCBvcGFjaXR5KCl7XG4gICAgICAgIHJldHVybiB0aGlzLl9vcGFjaXR5O1xuICAgIH1cbiAgICBzZXQgd2lkdGgod2lkdGgpe1xuICAgICAgICB0aGlzLl93aWR0aCA9IHdpZHRoO1xuICAgICAgICB0aGlzLl91bmlmb3Jtcy5saW5lV2lkdGgudmFsdWUgPSB3aWR0aDtcbiAgICB9XG4gICAgZ2V0IHdpZHRoKCl7XG4gICAgICAgIHJldHVybiB0aGlzLl93aWR0aDtcbiAgICB9XG4gICAgY2xvbmUoKXtcbiAgICAgICAgcmV0dXJuIG5ldyBMaW5lT3V0cHV0KHt3aWR0aDogdGhpcy53aWR0aCwgY29sb3I6IHRoaXMuY29sb3IsIG9wYWNpdHk6IHRoaXMub3BhY2l0eX0pO1xuICAgIH1cbn1cblxuZXhwb3J0IHtMaW5lT3V0cHV0fTtcbiIsImltcG9ydCB7T3V0cHV0Tm9kZX0gZnJvbSAnLi4vTm9kZS5qcyc7XG5pbXBvcnQgeyB0aHJlZUVudmlyb25tZW50IH0gZnJvbSAnLi4vVGhyZWVFbnZpcm9ubWVudC5qcyc7XG5cbmNsYXNzIFBvaW50T3V0cHV0IGV4dGVuZHMgT3V0cHV0Tm9kZXtcblx0Y29uc3RydWN0b3Iob3B0aW9ucyA9IHt9KXtcblx0XHRzdXBlcigpO1xuXHRcdC8qXG5cdFx0XHR3aWR0aDogbnVtYmVyXG5cdFx0XHRjb2xvcjogaGV4IGNvbG9yLCBhcyBpbiAweHJyZ2diYi4gVGVjaG5pY2FsbHksIHRoaXMgaXMgYSBKUyBpbnRlZ2VyLlxuXHRcdFx0b3BhY2l0eTogMC0xLiBPcHRpb25hbC5cblx0XHQqL1xuXG5cdFx0dGhpcy5fd2lkdGggPSBvcHRpb25zLndpZHRoICE9PSB1bmRlZmluZWQgPyBvcHRpb25zLndpZHRoIDogMTtcblx0XHR0aGlzLl9jb2xvciA9IG9wdGlvbnMuY29sb3IgIT09IHVuZGVmaW5lZCA/IG5ldyBUSFJFRS5Db2xvcihvcHRpb25zLmNvbG9yKSA6IG5ldyBUSFJFRS5Db2xvcigweDU1YWE1NSk7XG5cdFx0dGhpcy5fb3BhY2l0eSA9IG9wdGlvbnMub3BhY2l0eSAhPT0gdW5kZWZpbmVkID8gb3B0aW9ucy5vcGFjaXR5IDogMTtcblxuXHRcdHRoaXMucG9pbnRzID0gW107XG5cbiAgICAgICAgdGhpcy5tYXRlcmlhbCA9IG5ldyBUSFJFRS5NZXNoQmFzaWNNYXRlcmlhbCh7Y29sb3I6IHRoaXMuX2NvbG9yfSk7XG4gICAgICAgIHRoaXMub3BhY2l0eSA9IHRoaXMuX29wYWNpdHk7IC8vdHJpZ2dlciBzZXR0ZXIgdG8gc2V0IHRoaXMubWF0ZXJpYWwncyBvcGFjaXR5IHByb3Blcmx5XG5cblx0XHR0aGlzLm51bUNhbGxzUGVyQWN0aXZhdGlvbiA9IDA7IC8vc2hvdWxkIGFsd2F5cyBiZSBlcXVhbCB0byB0aGlzLnBvaW50cy5sZW5ndGhcblx0XHR0aGlzLl9hY3RpdmF0ZWRPbmNlID0gZmFsc2U7XG5cdH1cblx0X29uQWRkKCl7IC8vc2hvdWxkIGJlIGNhbGxlZCB3aGVuIHRoaXMgaXMgLmFkZCgpZWQgdG8gc29tZXRoaW5nXG5cdFx0Ly9jbGltYiB1cCBwYXJlbnQgaGllcmFyY2h5IHRvIGZpbmQgdGhlIEFyZWFcblx0XHRsZXQgcm9vdCA9IHRoaXMuZ2V0Q2xvc2VzdERvbWFpbigpO1xuXG5cdFx0dGhpcy5udW1DYWxsc1BlckFjdGl2YXRpb24gPSByb290Lm51bUNhbGxzUGVyQWN0aXZhdGlvbjtcblxuXHRcdGlmKHRoaXMucG9pbnRzLmxlbmd0aCA8IHRoaXMubnVtQ2FsbHNQZXJBY3RpdmF0aW9uKXtcblx0XHRcdGZvcih2YXIgaT10aGlzLnBvaW50cy5sZW5ndGg7aTx0aGlzLm51bUNhbGxzUGVyQWN0aXZhdGlvbjtpKyspe1xuXHRcdFx0XHR0aGlzLnBvaW50cy5wdXNoKG5ldyBQb2ludE1lc2goe3dpZHRoOiAxLG1hdGVyaWFsOnRoaXMubWF0ZXJpYWx9KSk7XG5cdFx0XHRcdHRoaXMucG9pbnRzW2ldLm1lc2guc2NhbGUuc2V0U2NhbGFyKHRoaXMuX3dpZHRoKTsgLy9zZXQgd2lkdGggYnkgc2NhbGluZyBwb2ludFxuXHRcdFx0fVxuXHRcdH1cblx0fVxuXHRfb25GaXJzdEFjdGl2YXRpb24oKXtcblx0XHRpZih0aGlzLnBvaW50cy5sZW5ndGggPCB0aGlzLm51bUNhbGxzUGVyQWN0aXZhdGlvbil0aGlzLl9vbkFkZCgpO1xuXHR9XG5cdGV2YWx1YXRlU2VsZihpLCB0LCB4LCB5LCB6KXtcblx0XHRpZighdGhpcy5fYWN0aXZhdGVkT25jZSl7XG5cdFx0XHR0aGlzLl9hY3RpdmF0ZWRPbmNlID0gdHJ1ZTtcblx0XHRcdHRoaXMuX29uRmlyc3RBY3RpdmF0aW9uKCk7XHRcblx0XHR9XG5cdFx0Ly9pdCdzIGFzc3VtZWQgaSB3aWxsIGdvIGZyb20gMCB0byB0aGlzLm51bUNhbGxzUGVyQWN0aXZhdGlvbiwgc2luY2UgdGhpcyBzaG91bGQgb25seSBiZSBjYWxsZWQgZnJvbSBhbiBBcmVhLlxuXHRcdHZhciBwb2ludCA9IHRoaXMuZ2V0UG9pbnQoaSk7XG5cdFx0cG9pbnQueCA9IHggPT09IHVuZGVmaW5lZCA/IDAgOiB4O1xuXHRcdHBvaW50LnkgPSB5ID09PSB1bmRlZmluZWQgPyAwIDogeTtcblx0XHRwb2ludC56ID0geiA9PT0gdW5kZWZpbmVkID8gMCA6IHo7XG5cdH1cblx0Z2V0UG9pbnQoaSl7XG5cdFx0cmV0dXJuIHRoaXMucG9pbnRzW2ldO1xuXHR9XG4gICAgcmVtb3ZlU2VsZkZyb21TY2VuZSgpe1xuXHRcdGZvcih2YXIgaT0wO2k8dGhpcy5wb2ludHMubGVuZ3RoO2krKyl7XG5cdFx0XHR0aGlzLnBvaW50c1tpXS5yZW1vdmVTZWxmRnJvbVNjZW5lKCk7XG5cdFx0fVxuICAgIH1cblx0c2V0IG9wYWNpdHkob3BhY2l0eSl7XG5cdFx0Ly90ZWNobmljYWxseSB0aGlzIHNldHMgYWxsIHBvaW50cyB0byB0aGUgc2FtZSBjb2xvci4gVG9kbzogYWxsb3cgZGlmZmVyZW50IHBvaW50cyB0byBiZSBkaWZmZXJlbnRseSBjb2xvcmVkLlxuXHRcdFxuXHRcdGxldCBtYXQgPSB0aGlzLm1hdGVyaWFsO1xuXHRcdG1hdC5vcGFjaXR5ID0gb3BhY2l0eTsgLy9pbnN0YW50aWF0ZSB0aGUgcG9pbnRcblx0XHRtYXQudHJhbnNwYXJlbnQgPSBvcGFjaXR5IDwgMTtcbiAgICAgICAgbWF0LnZpc2libGUgPSBvcGFjaXR5ID4gMDtcblx0XHR0aGlzLl9vcGFjaXR5ID0gb3BhY2l0eTtcblx0fVxuXHRnZXQgb3BhY2l0eSgpe1xuXHRcdHJldHVybiB0aGlzLl9vcGFjaXR5O1xuXHR9XG5cdHNldCBjb2xvcihjb2xvcil7XG4gICAgICAgIHRoaXMubWF0ZXJpYWwuY29sb3IgPSBjb2xvcjtcblx0XHR0aGlzLl9jb2xvciA9IGNvbG9yO1xuXHR9XG5cdGdldCBjb2xvcigpe1xuXHRcdHJldHVybiB0aGlzLl9jb2xvcjtcblx0fVxuXHRzZXQgd2lkdGgod2lkdGgpe1xuXHRcdGZvcih2YXIgaT0wO2k8dGhpcy5wb2ludHMubGVuZ3RoO2krKyl7XG5cdFx0XHR0aGlzLmdldFBvaW50KGkpLm1lc2guc2NhbGUuc2V0U2NhbGFyKHdpZHRoKTtcblx0XHR9XG5cdFx0dGhpcy5fd2lkdGggPSB3aWR0aDtcblx0fVxuXHRnZXQgd2lkdGgoKXtcblx0XHRyZXR1cm4gdGhpcy5fd2lkdGg7XG5cdH1cblx0Y2xvbmUoKXtcblx0XHRyZXR1cm4gbmV3IFBvaW50T3V0cHV0KHt3aWR0aDogdGhpcy53aWR0aCwgY29sb3I6IHRoaXMuY29sb3IsIG9wYWNpdHk6IHRoaXMub3BhY2l0eX0pO1xuXHR9XG59XG5cblxuY2xhc3MgUG9pbnRNZXNoe1xuXHRjb25zdHJ1Y3RvcihvcHRpb25zKXtcblx0XHQvKm9wdGlvbnM6XG5cdFx0XHR4LHk6IG51bWJlcnNcblx0XHRcdHdpZHRoOiBudW1iZXJcbiAgICAgICAgICAgIG1hdGVyaWFsOiBcblx0XHQqL1xuXG5cdFx0bGV0IHdpZHRoID0gb3B0aW9ucy53aWR0aCA9PT0gdW5kZWZpbmVkID8gMSA6IG9wdGlvbnMud2lkdGhcbiAgICAgICAgdGhpcy5tYXRlcmlhbCA9IG9wdGlvbnMubWF0ZXJpYWw7IC8vb25lIG1hdGVyaWFsIHBlciBQb2ludE91dHB1dFxuXG5cdFx0dGhpcy5tZXNoID0gbmV3IFRIUkVFLk1lc2godGhpcy5zaGFyZWRDaXJjbGVHZW9tZXRyeSx0aGlzLm1hdGVyaWFsKTtcblxuXHRcdHRoaXMubWVzaC5wb3NpdGlvbi5zZXQodGhpcy54LHRoaXMueSx0aGlzLnopO1xuXHRcdHRoaXMubWVzaC5zY2FsZS5zZXRTY2FsYXIodGhpcy53aWR0aC8yKTtcblx0XHR0aHJlZUVudmlyb25tZW50LnNjZW5lLmFkZCh0aGlzLm1lc2gpO1xuXG5cdFx0dGhpcy54ID0gb3B0aW9ucy54IHx8IDA7XG5cdFx0dGhpcy55ID0gb3B0aW9ucy55IHx8IDA7XG5cdFx0dGhpcy56ID0gb3B0aW9ucy56IHx8IDA7XG5cdH1cblx0cmVtb3ZlU2VsZkZyb21TY2VuZSgpe1xuXHRcdHRocmVlRW52aXJvbm1lbnQuc2NlbmUucmVtb3ZlKHRoaXMubWVzaCk7XG5cdH1cblx0c2V0IHgoaSl7XG5cdFx0dGhpcy5tZXNoLnBvc2l0aW9uLnggPSBpO1xuXHR9XG5cdHNldCB5KGkpe1xuXHRcdHRoaXMubWVzaC5wb3NpdGlvbi55ID0gaTtcblx0fVxuXHRzZXQgeihpKXtcblx0XHR0aGlzLm1lc2gucG9zaXRpb24ueiA9IGk7XG5cdH1cblx0Z2V0IHgoKXtcblx0XHRyZXR1cm4gdGhpcy5tZXNoLnBvc2l0aW9uLng7XG5cdH1cblx0Z2V0IHkoKXtcblx0XHRyZXR1cm4gdGhpcy5tZXNoLnBvc2l0aW9uLnk7XG5cdH1cblx0Z2V0IHooKXtcblx0XHRyZXR1cm4gdGhpcy5tZXNoLnBvc2l0aW9uLno7XG5cdH1cbn1cblBvaW50TWVzaC5wcm90b3R5cGUuc2hhcmVkQ2lyY2xlR2VvbWV0cnkgPSBuZXcgVEhSRUUuU3BoZXJlR2VvbWV0cnkoMS8yLCA4LCA2KTsgLy9yYWRpdXMgMS8yIG1ha2VzIGRpYW1ldGVyIDEsIHNvIHRoYXQgc2NhbGluZyBieSBuIG1lYW5zIHdpZHRoPW5cblxuLy90ZXN0aW5nIGNvZGVcbmZ1bmN0aW9uIHRlc3RQb2ludCgpe1xuXHR2YXIgeCA9IG5ldyBFWFAuQXJlYSh7Ym91bmRzOiBbWy0xMCwxMF1dfSk7XG5cdHZhciB5ID0gbmV3IEVYUC5UcmFuc2Zvcm1hdGlvbih7J2V4cHInOiAoeCkgPT4geCp4fSk7XG5cdHZhciB5ID0gbmV3IEVYUC5Qb2ludE91dHB1dCgpO1xuXHR4LmFkZCh5KTtcblx0eS5hZGQoeik7XG5cdHguYWN0aXZhdGUoKTtcbn1cblxuZXhwb3J0IHtQb2ludE91dHB1dCwgUG9pbnRNZXNofVxuIiwiaW1wb3J0IHsgTGluZU91dHB1dCB9IGZyb20gJy4vTGluZU91dHB1dC5qcyc7XG5pbXBvcnQgeyBVdGlscyB9IGZyb20gJy4uL3V0aWxzLmpzJztcbmltcG9ydCB7IHRocmVlRW52aXJvbm1lbnQgfSBmcm9tICcuLi9UaHJlZUVudmlyb25tZW50LmpzJztcblxuZXhwb3J0IGNsYXNzIFZlY3Rvck91dHB1dCBleHRlbmRzIExpbmVPdXRwdXR7XG4gICAgY29uc3RydWN0b3Iob3B0aW9ucyA9IHt9KXtcbiAgICAgICAgLyppbnB1dDogVHJhbnNmb3JtYXRpb25cbiAgICAgICAgICAgIHdpZHRoOiBudW1iZXJcbiAgICAgICAgKi9cbiAgICAgICAgc3VwZXIob3B0aW9ucyk7XG5cbiAgICB9XG4gICAgaW5pdCgpe1xuICAgICAgICB0aGlzLmFycm93TWF0ZXJpYWwgPSBuZXcgVEhSRUUuTGluZUJhc2ljTWF0ZXJpYWwoe2NvbG9yOiB0aGlzLl9jb2xvciwgbGluZXdpZHRoOiB0aGlzLl93aWR0aCwgb3BhY2l0eTp0aGlzLl9vcGFjaXR5fSk7XG5cbiAgICAgICAgc3VwZXIuaW5pdCgpO1xuICAgICAgICB0aGlzLmFycm93aGVhZHMgPSBbXTtcblxuICAgICAgICAvL1RPRE86IG1ha2UgdGhlIGFycm93IHRpcCBjb2xvcnMgbWF0Y2ggdGhlIGNvbG9ycyBvZiB0aGUgbGluZXMnIHRpcHNcblxuICAgICAgICBjb25zdCBjaXJjbGVSZXNvbHV0aW9uID0gMTI7XG4gICAgICAgIGNvbnN0IGFycm93aGVhZFNpemUgPSAwLjM7XG4gICAgICAgIGNvbnN0IEVQU0lMT04gPSAwLjAwMDAxO1xuICAgICAgICB0aGlzLkVQU0lMT04gPSBFUFNJTE9OO1xuXG4gICAgICAgIHRoaXMuY29uZUdlb21ldHJ5ID0gbmV3IFRIUkVFLkN5bGluZGVyQnVmZmVyR2VvbWV0cnkoIDAsIGFycm93aGVhZFNpemUsIGFycm93aGVhZFNpemUqMS43LCBjaXJjbGVSZXNvbHV0aW9uLCAxICk7XG4gICAgICAgIGxldCBhcnJvd2hlYWRPdmVyc2hvb3RGYWN0b3IgPSAwLjE7IC8vdXNlZCBzbyB0aGF0IHRoZSBsaW5lIHdvbid0IHJ1ZGVseSBjbGlwIHRocm91Z2ggdGhlIHBvaW50IG9mIHRoZSBhcnJvd2hlYWRcbiAgICAgICAgdGhpcy5jb25lR2VvbWV0cnkudHJhbnNsYXRlKCAwLCAtIGFycm93aGVhZFNpemUgKyBhcnJvd2hlYWRPdmVyc2hvb3RGYWN0b3IsIDAgKTtcbiAgICAgICAgdGhpcy5fY29uZVVwRGlyZWN0aW9uID0gbmV3IFRIUkVFLlZlY3RvcjMoMCwxLDApO1xuICAgIH1cbiAgICBfb25GaXJzdEFjdGl2YXRpb24oKXtcbiAgICAgICAgc3VwZXIuX29uRmlyc3RBY3RpdmF0aW9uKCk7XG5cbiAgICAgICAgaWYodGhpcy5pdGVtRGltZW5zaW9ucy5sZW5ndGggPiAxKXtcbiAgICAgICAgICAgIHRoaXMubnVtQXJyb3doZWFkcyA9IHRoaXMuaXRlbURpbWVuc2lvbnMuc2xpY2UoMCx0aGlzLml0ZW1EaW1lbnNpb25zLmxlbmd0aC0xKS5yZWR1Y2UoZnVuY3Rpb24ocHJldiwgY3VycmVudCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGN1cnJlbnQgKyBwcmV2O1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgLy9hc3N1bWVkIGl0ZW1EaW1lbnNpb25zIGlzbid0IGEgbm9uemVybyBhcnJheS4gVGhhdCBzaG91bGQgYmUgdGhlIGNvbnN0cnVjdG9yJ3MgcHJvYmxlbS5cbiAgICAgICAgICAgIHRoaXMubnVtQXJyb3doZWFkcyA9IDE7XG4gICAgICAgIH1cblxuICAgICAgICAvL3JlbW92ZSBhbnkgcHJldmlvdXMgYXJyb3doZWFkc1xuICAgICAgICBmb3IodmFyIGk9MDtpPHRoaXMuYXJyb3doZWFkcy5sZW5ndGg7aSsrKXtcbiAgICAgICAgICAgIGxldCBhcnJvdyA9IHRoaXMuYXJyb3doZWFkc1tpXTtcbiAgICAgICAgICAgIHRocmVlRW52aXJvbm1lbnQuc2NlbmUucmVtb3ZlKGFycm93KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuYXJyb3doZWFkcyA9IG5ldyBBcnJheSh0aGlzLm51bUFycm93aGVhZHMpO1xuICAgICAgICBmb3IodmFyIGk9MDtpPHRoaXMubnVtQXJyb3doZWFkcztpKyspe1xuICAgICAgICAgICAgdGhpcy5hcnJvd2hlYWRzW2ldID0gbmV3IFRIUkVFLk1lc2godGhpcy5jb25lR2VvbWV0cnksIHRoaXMuYXJyb3dNYXRlcmlhbCk7XG4gICAgICAgICAgICB0aGlzLm1lc2guYWRkKHRoaXMuYXJyb3doZWFkc1tpXSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc29sZS5sb2coXCJudW1iZXIgb2YgYXJyb3doZWFkcyAoPSBudW1iZXIgb2YgbGluZXMpOlwiKyB0aGlzLm51bUFycm93aGVhZHMpO1xuICAgIH1cbiAgICBldmFsdWF0ZVNlbGYoaSwgdCwgeCwgeSwgeil7XG4gICAgICAgIC8vaXQncyBhc3N1bWVkIGkgd2lsbCBnbyBmcm9tIDAgdG8gdGhpcy5udW1DYWxsc1BlckFjdGl2YXRpb24sIHNpbmNlIHRoaXMgc2hvdWxkIG9ubHkgYmUgY2FsbGVkIGZyb20gYW4gQXJlYS5cbiAgICAgICAgc3VwZXIuZXZhbHVhdGVTZWxmKGksdCx4LHkseik7XG5cbiAgICAgICAgY29uc3QgbGFzdERpbWVuc2lvbkxlbmd0aCA9IHRoaXMuaXRlbURpbWVuc2lvbnNbdGhpcy5pdGVtRGltZW5zaW9ucy5sZW5ndGgtMV07XG4gICAgICAgIGxldCBmaXJzdENvb3JkaW5hdGUgPSBpICUgbGFzdERpbWVuc2lvbkxlbmd0aDtcblxuICAgICAgICAvL2Jvb2xlYW4gdmFyaWFibGVzLiBpZiBpbiB0aGUgZnV0dXJlIExpbmVPdXRwdXQgY2FuIHN1cHBvcnQgdmFyaWFibGUtd2lkdGggbGluZXMsIHRoZXNlIHNob3VsZCBlYiBjaGFuZ2VkXG4gICAgICAgIGxldCBzdGFydGluZ05ld0xpbmUgPSBmaXJzdENvb3JkaW5hdGUgPT0gMDtcbiAgICAgICAgbGV0IGVuZGluZ05ld0xpbmUgPSBmaXJzdENvb3JkaW5hdGUgPT0gbGFzdERpbWVuc2lvbkxlbmd0aC0xO1xuXG4gICAgICAgIGlmKGVuZGluZ05ld0xpbmUpe1xuICAgICAgICAgICAgLy93ZSBuZWVkIHRvIHVwZGF0ZSBhcnJvd3NcbiAgICAgICAgICAgIC8vY2FsY3VsYXRlIGRpcmVjdGlvbiBvZiBsYXN0IGxpbmUgc2VnbWVudFxuICAgICAgICAgICAgLy90aGlzIHBvaW50IGlzIGN1cnJlbnRQb2ludEluZGV4LTEgYmVjYXVzZSBjdXJyZW50UG9pbnRJbmRleCB3YXMgaW5jcmVhc2VkIGJ5IDEgZHVyaW5nIHN1cGVyLmV2YWx1YXRlU2VsZigpXG4gICAgICAgICAgICBsZXQgaW5kZXggPSAodGhpcy5fY3VycmVudFBvaW50SW5kZXgtMSkqdGhpcy5fb3V0cHV0RGltZW5zaW9ucyo0O1xuXG4gICAgICAgICAgICBsZXQgcHJldlggPSB0aGlzLl92ZXJ0aWNlc1sodGhpcy5fY3VycmVudFBvaW50SW5kZXgtMikqdGhpcy5fb3V0cHV0RGltZW5zaW9ucyo0XTtcbiAgICAgICAgICAgIGxldCBwcmV2WSA9IHRoaXMuX3ZlcnRpY2VzWyh0aGlzLl9jdXJyZW50UG9pbnRJbmRleC0yKSp0aGlzLl9vdXRwdXREaW1lbnNpb25zKjQrMV07XG4gICAgICAgICAgICBsZXQgcHJldlogPSB0aGlzLl92ZXJ0aWNlc1sodGhpcy5fY3VycmVudFBvaW50SW5kZXgtMikqdGhpcy5fb3V0cHV0RGltZW5zaW9ucyo0KzJdO1xuXG4gICAgICAgICAgICBsZXQgZHggPSBwcmV2WCAtIHRoaXMuX3ZlcnRpY2VzW2luZGV4XTtcbiAgICAgICAgICAgIGxldCBkeSA9IHByZXZZIC0gdGhpcy5fdmVydGljZXNbaW5kZXgrMV07XG4gICAgICAgICAgICBsZXQgZHogPSBwcmV2WiAtIHRoaXMuX3ZlcnRpY2VzW2luZGV4KzJdO1xuXG4gICAgICAgICAgICBsZXQgbGluZU51bWJlciA9IE1hdGguZmxvb3IoaSAvIGxhc3REaW1lbnNpb25MZW5ndGgpO1xuICAgICAgICAgICAgVXRpbHMuYXNzZXJ0KGxpbmVOdW1iZXIgPD0gdGhpcy5udW1BcnJvd2hlYWRzKTsgLy90aGlzIG1heSBiZSB3cm9uZ1xuXG4gICAgICAgICAgICBsZXQgZGlyZWN0aW9uVmVjdG9yID0gbmV3IFRIUkVFLlZlY3RvcjMoLWR4LC1keSwtZHopO1xuXG4gICAgICAgICAgICAvL01ha2UgYXJyb3dzIGRpc2FwcGVhciBpZiB0aGUgbGluZSBpcyBzbWFsbCBlbm91Z2hcbiAgICAgICAgICAgIC8vT25lIHdheSB0byBkbyB0aGlzIHdvdWxkIGJlIHRvIHN1bSB0aGUgZGlzdGFuY2VzIG9mIGFsbCBsaW5lIHNlZ21lbnRzLiBJJ20gY2hlYXRpbmcgaGVyZSBhbmQganVzdCBtZWFzdXJpbmcgdGhlIGRpc3RhbmNlIG9mIHRoZSBsYXN0IHZlY3RvciwgdGhlbiBtdWx0aXBseWluZyBieSB0aGUgbnVtYmVyIG9mIGxpbmUgc2VnbWVudHMgKG5haXZlbHkgYXNzdW1pbmcgYWxsIGxpbmUgc2VnbWVudHMgYXJlIHRoZSBzYW1lIGxlbmd0aClcbiAgICAgICAgICAgIGxldCBsZW5ndGggPSBkaXJlY3Rpb25WZWN0b3IubGVuZ3RoKCkgKiAobGFzdERpbWVuc2lvbkxlbmd0aC0xKTtcblxuICAgICAgICAgICAgY29uc3QgZWZmZWN0aXZlRGlzdGFuY2UgPSAzO1xuICAgICAgICAgICAgbGV0IGNsYW1wZWRMZW5ndGggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihsZW5ndGgvZWZmZWN0aXZlRGlzdGFuY2UsIDEpKTtcblxuICAgICAgICAgICAgLy9zaHJpbmsgZnVuY3Rpb24gZGVzaWduZWQgdG8gaGF2ZSBhIHN0ZWVwIHNsb3BlIGNsb3NlIHRvIDAgYnV0IG1lbGxvdyBvdXQgYXQgMC41IG9yIHNvIGluIG9yZGVyIHRvIGF2b2lkIHRoZSBsaW5lIHdpZHRoIG92ZXJjb21pbmcgdGhlIGFycm93aGVhZCB3aWR0aFxuICAgICAgICAgICAgLy9JbiBDaHJvbWUsIHRocmVlLmpzIGNvbXBsYWlucyB3aGVuZXZlciBzb21ldGhpbmcgaXMgc2V0IHRvIDAgc2NhbGUuIEFkZGluZyBhbiBlcHNpbG9uIHRlcm0gaXMgdW5mb3J0dW5hdGUgYnV0IG5lY2Vzc2FyeSB0byBhdm9pZCBjb25zb2xlIHNwYW0uXG4gICAgICAgICAgICB0aGlzLmFycm93aGVhZHNbbGluZU51bWJlcl0uc2NhbGUuc2V0U2NhbGFyKE1hdGguYWNvcygxLTIqY2xhbXBlZExlbmd0aCkvTWF0aC5QSSArIHRoaXMuRVBTSUxPTik7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgICAvL3Bvc2l0aW9uL3JvdGF0aW9uIGNvbWVzIGFmdGVyIHNpbmNlIC5ub3JtYWxpemUoKSBtb2RpZmllcyBkaXJlY3Rpb25WZWN0b3IgaW4gcGxhY2VcbiAgICAgICAgICAgIGxldCBwb3MgPSB0aGlzLmFycm93aGVhZHNbbGluZU51bWJlcl0ucG9zaXRpb247XG4gICAgICAgICAgICBwb3MueCA9IHggPT09IHVuZGVmaW5lZCA/IDAgOiB4O1xuICAgICAgICAgICAgcG9zLnkgPSB5ID09PSB1bmRlZmluZWQgPyAwIDogeTtcbiAgICAgICAgICAgIHBvcy56ID0geiA9PT0gdW5kZWZpbmVkID8gMCA6IHo7XG5cbiAgICAgICAgICAgIGlmKGxlbmd0aCA+IDApeyAvL2RpcmVjdGlvblZlY3Rvci5ub3JtYWxpemUoKSBmYWlscyB3aXRoIDAgbGVuZ3RoXG4gICAgICAgICAgICAgICAgdGhpcy5hcnJvd2hlYWRzW2xpbmVOdW1iZXJdLnF1YXRlcm5pb24uc2V0RnJvbVVuaXRWZWN0b3JzKHRoaXMuX2NvbmVVcERpcmVjdGlvbiwgZGlyZWN0aW9uVmVjdG9yLm5vcm1hbGl6ZSgpICk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cblxuICAgIHNldCBjb2xvcihjb2xvcil7XG4gICAgICAgIC8vY3VycmVudGx5IG9ubHkgYSBzaW5nbGUgY29sb3IgaXMgc3VwcG9ydGVkLlxuICAgICAgICAvL0kgc2hvdWxkIHJlYWxseSBtYWtlIGl0IHBvc3NpYmxlIHRvIHNwZWNpZnkgY29sb3IgYnkgYSBmdW5jdGlvbi5cbiAgICAgICAgdGhpcy5fY29sb3IgPSBjb2xvcjtcbiAgICAgICAgdGhpcy5zZXRBbGxWZXJ0aWNlc1RvQ29sb3IoY29sb3IpO1xuICAgICAgICB0aGlzLmFycm93TWF0ZXJpYWwuY29sb3IgPSB0aGlzLl9jb2xvcjtcbiAgICB9XG5cbiAgICBnZXQgY29sb3IoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2NvbG9yO1xuICAgIH1cblxuICAgIHNldCBvcGFjaXR5KG9wYWNpdHkpe1xuICAgICAgICB0aGlzLmFycm93TWF0ZXJpYWwub3BhY2l0eSA9IG9wYWNpdHk7XG4gICAgICAgIHRoaXMuYXJyb3dNYXRlcmlhbC50cmFuc3BhcmVudCA9IG9wYWNpdHkgPCAxO1xuICAgICAgICB0aGlzLmFycm93TWF0ZXJpYWwudmlzaWJsZSA9IG9wYWNpdHkgPiAwO1xuXG4gICAgICAgIHRoaXMubWF0ZXJpYWwub3BhY2l0eSA9IG9wYWNpdHk7XG4gICAgICAgIHRoaXMubWF0ZXJpYWwudHJhbnNwYXJlbnQgPSBvcGFjaXR5IDwgMTtcbiAgICAgICAgdGhpcy5tYXRlcmlhbC52aXNpYmxlID0gb3BhY2l0eSA+IDA7XG4gICAgICAgIHRoaXMuX29wYWNpdHkgPSBvcGFjaXR5O1xuICAgICAgICB0aGlzLl91bmlmb3Jtcy5vcGFjaXR5LnZhbHVlID0gb3BhY2l0eTtcbiAgICB9XG5cbiAgICBnZXQgb3BhY2l0eSgpe1xuICAgICAgICByZXR1cm4gdGhpcy5fb3BhY2l0eTtcbiAgICB9XG4gICAgcmVtb3ZlU2VsZkZyb21TY2VuZSgpe1xuICAgICAgICB0aHJlZUVudmlyb25tZW50LnNjZW5lLnJlbW92ZSh0aGlzLm1lc2gpO1xuICAgICAgICBmb3IodmFyIGk9MDtpPHRoaXMubnVtQXJyb3doZWFkcztpKyspe1xuICAgICAgICAgICAgdGhyZWVFbnZpcm9ubWVudC5zY2VuZS5yZW1vdmUodGhpcy5hcnJvd2hlYWRzW2ldKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBjbG9uZSgpe1xuICAgICAgICByZXR1cm4gbmV3IFZlY3Rvck91dHB1dCh7d2lkdGg6IHRoaXMud2lkdGgsIGNvbG9yOiB0aGlzLmNvbG9yLCBvcGFjaXR5OiB0aGlzLm9wYWNpdHl9KTtcbiAgICB9XG59XG5cblxuIiwiLy9TdXJmYWNlT3V0cHV0U2hhZGVycy5qc1xuXG4vL2V4cGVyaW1lbnQ6IHNoYWRlcnMgdG8gZ2V0IHRoZSB0cmlhbmdsZSBwdWxzYXRpbmchXG52YXIgdlNoYWRlciA9IFtcblwidmFyeWluZyB2ZWMzIHZOb3JtYWw7XCIsXG5cInZhcnlpbmcgdmVjMyB2UG9zaXRpb247XCIsXG5cInZhcnlpbmcgdmVjMiB2VXY7XCIsXG5cInVuaWZvcm0gZmxvYXQgdGltZTtcIixcblwidW5pZm9ybSB2ZWMzIGNvbG9yO1wiLFxuXCJ1bmlmb3JtIHZlYzMgdkxpZ2h0O1wiLFxuXCJ1bmlmb3JtIGZsb2F0IGdyaWRTcXVhcmVzO1wiLFxuXG5cInZvaWQgbWFpbigpIHtcIixcblx0XCJ2UG9zaXRpb24gPSBwb3NpdGlvbi54eXo7XCIsXG5cdFwidk5vcm1hbCA9IG5vcm1hbC54eXo7XCIsXG5cdFwidlV2ID0gdXYueHk7XCIsXG5cdFwiZ2xfUG9zaXRpb24gPSBwcm9qZWN0aW9uTWF0cml4ICpcIixcbiAgICAgICAgICAgIFwibW9kZWxWaWV3TWF0cml4ICpcIixcbiAgICAgICAgICAgIFwidmVjNChwb3NpdGlvbiwxLjApO1wiLFxuXCJ9XCJdLmpvaW4oXCJcXG5cIilcblxudmFyIGZTaGFkZXIgPSBbXG5cInZhcnlpbmcgdmVjMyB2Tm9ybWFsO1wiLFxuXCJ2YXJ5aW5nIHZlYzMgdlBvc2l0aW9uO1wiLFxuXCJ2YXJ5aW5nIHZlYzIgdlV2O1wiLFxuXCJ1bmlmb3JtIGZsb2F0IHRpbWU7XCIsXG5cInVuaWZvcm0gdmVjMyBjb2xvcjtcIixcblwidW5pZm9ybSBmbG9hdCB1c2VDdXN0b21HcmlkQ29sb3I7XCIsXG5cInVuaWZvcm0gdmVjMyBncmlkQ29sb3I7XCIsXG5cInVuaWZvcm0gdmVjMyB2TGlnaHQ7XCIsXG5cInVuaWZvcm0gZmxvYXQgZ3JpZFNxdWFyZXM7XCIsXG5cInVuaWZvcm0gZmxvYXQgbGluZVdpZHRoO1wiLFxuXCJ1bmlmb3JtIGZsb2F0IHNob3dHcmlkO1wiLFxuXCJ1bmlmb3JtIGZsb2F0IHNob3dTb2xpZDtcIixcblwidW5pZm9ybSBmbG9hdCBvcGFjaXR5O1wiLFxuXG5cdC8vdGhlIGZvbGxvd2luZyBjb2RlIGZyb20gaHR0cHM6Ly9naXRodWIuY29tL3VuY29uZWQvbWF0aGJveC9ibG9iL2VhZWI4ZTE1ZWYyZDAyNTI3NDBhNzQ1MDVhMTJkN2ExMDUxYTYxYjYvc3JjL3NoYWRlcnMvZ2xzbC9tZXNoLmZyYWdtZW50LnNoYWRlZC5nbHNsXG5cInZlYzMgb2ZmU3BlY3VsYXIodmVjMyBjb2xvcikge1wiLFxuXCIgIHZlYzMgYyA9IDEuMCAtIGNvbG9yO1wiLFxuXCIgIHJldHVybiAxLjAgLSBjICogYztcIixcblwifVwiLFxuXG5cInZlYzQgZ2V0U2hhZGVkQ29sb3IodmVjNCByZ2JhKSB7IFwiLFxuXCIgIHZlYzMgY29sb3IgPSByZ2JhLnh5ejtcIixcblwiICB2ZWMzIGNvbG9yMiA9IG9mZlNwZWN1bGFyKHJnYmEueHl6KTtcIixcblxuXCIgIHZlYzMgbm9ybWFsID0gbm9ybWFsaXplKHZOb3JtYWwpO1wiLFxuXCIgIHZlYzMgbGlnaHQgPSBub3JtYWxpemUodkxpZ2h0KTtcIixcblwiICB2ZWMzIHBvc2l0aW9uID0gbm9ybWFsaXplKHZQb3NpdGlvbik7XCIsXG5cblwiICBmbG9hdCBzaWRlICAgID0gZ2xfRnJvbnRGYWNpbmcgPyAtMS4wIDogMS4wO1wiLFxuXCIgIGZsb2F0IGNvc2luZSAgPSBzaWRlICogZG90KG5vcm1hbCwgbGlnaHQpO1wiLFxuXCIgIGZsb2F0IGRpZmZ1c2UgPSBtaXgobWF4KDAuMCwgY29zaW5lKSwgLjUgKyAuNSAqIGNvc2luZSwgLjEpO1wiLFxuXG5cIiAgZmxvYXQgcmltTGlnaHRpbmcgPSBtYXgobWluKDEuMCAtIHNpZGUqZG90KG5vcm1hbCwgbGlnaHQpLCAxLjApLDAuMCk7XCIsXG5cblwiXHRmbG9hdCBzcGVjdWxhciA9IG1heCgwLjAsIGFicyhjb3NpbmUpIC0gMC41KTtcIiwgLy9kb3VibGUgc2lkZWQgc3BlY3VsYXJcblwiICAgcmV0dXJuIHZlYzQoZGlmZnVzZSpjb2xvciArIDAuOSpyaW1MaWdodGluZypjb2xvciArIDAuNCpjb2xvcjIgKiBzcGVjdWxhciwgcmdiYS5hKTtcIixcblwifVwiLFxuXG4vLyBTbW9vdGggSFNWIHRvIFJHQiBjb252ZXJzaW9uIGZyb20gaHR0cHM6Ly93d3cuc2hhZGVydG95LmNvbS92aWV3L01zUzNXY1xuXCJ2ZWMzIGhzdjJyZ2Jfc21vb3RoKCBpbiB2ZWMzIGMgKXtcIixcblwiICAgIHZlYzMgcmdiID0gY2xhbXAoIGFicyhtb2QoYy54KjYuMCt2ZWMzKDAuMCw0LjAsMi4wKSw2LjApLTMuMCktMS4wLCAwLjAsIDEuMCApO1wiLFxuXCJcdHJnYiA9IHJnYipyZ2IqKDMuMC0yLjAqcmdiKTsgLy8gY3ViaWMgc21vb3RoaW5nXHRcIixcblwiXHRyZXR1cm4gYy56ICogbWl4KCB2ZWMzKDEuMCksIHJnYiwgYy55KTtcIixcblwifVwiLFxuXG4vL0Zyb20gU2FtIEhvY2V2YXI6IGh0dHA6Ly9sb2xlbmdpbmUubmV0L2Jsb2cvMjAxMy8wNy8yNy9yZ2ItdG8taHN2LWluLWdsc2xcblwidmVjMyByZ2IyaHN2KHZlYzMgYyl7XCIsXG5cIiAgICB2ZWM0IEsgPSB2ZWM0KDAuMCwgLTEuMCAvIDMuMCwgMi4wIC8gMy4wLCAtMS4wKTtcIixcblwiICAgIHZlYzQgcCA9IG1peCh2ZWM0KGMuYmcsIEsud3opLCB2ZWM0KGMuZ2IsIEsueHkpLCBzdGVwKGMuYiwgYy5nKSk7XCIsXG5cIiAgICB2ZWM0IHEgPSBtaXgodmVjNChwLnh5dywgYy5yKSwgdmVjNChjLnIsIHAueXp4KSwgc3RlcChwLngsIGMucikpO1wiLFxuXG5cIiAgICBmbG9hdCBkID0gcS54IC0gbWluKHEudywgcS55KTtcIixcblwiICAgIGZsb2F0IGUgPSAxLjBlLTEwO1wiLFxuXCIgICAgcmV0dXJuIHZlYzMoYWJzKHEueiArIChxLncgLSBxLnkpIC8gKDYuMCAqIGQgKyBlKSksIGQgLyAocS54ICsgZSksIHEueCk7XCIsXG5cIn1cIixcbiAvL2Nob29zZXMgdGhlIGNvbG9yIGZvciB0aGUgZ3JpZGxpbmVzIGJ5IHZhcnlpbmcgbGlnaHRuZXNzLiBcbi8vTk9UIGNvbnRpbnVvdXMgb3IgZWxzZSBieSB0aGUgaW50ZXJtZWRpYXRlIGZ1bmN0aW9uIHRoZW9yZW0gdGhlcmUnZCBiZSBhIHBvaW50IHdoZXJlIHRoZSBncmlkbGluZXMgd2VyZSB0aGUgc2FtZSBjb2xvciBhcyB0aGUgbWF0ZXJpYWwuXG5cInZlYzMgZ3JpZExpbmVDb2xvcih2ZWMzIGNvbG9yKXtcIixcblwiIHZlYzMgaHN2ID0gcmdiMmhzdihjb2xvci54eXopO1wiLFxuXCIgLy9oc3YueCArPSAwLjE7XCIsXG5cIiBpZihoc3YueiA8IDAuOCl7aHN2LnogKz0gMC4yO31lbHNle2hzdi56ID0gMC44NS0wLjEqaHN2Lno7aHN2LnkgLT0gMC4wO31cIixcblwiIHJldHVybiBoc3YycmdiX3Ntb290aChoc3YpO1wiLFxuXCJ9XCIsXG5cblwidmVjNCByZW5kZXJHcmlkbGluZXModmVjNCBleGlzdGluZ0NvbG9yLCB2ZWMyIHV2LCB2ZWM0IHNvbGlkQ29sb3IpIHtcIixcblwiICB2ZWMyIGRpc3RUb0VkZ2UgPSBhYnMobW9kKHZVdi54eSpncmlkU3F1YXJlcyArIGxpbmVXaWR0aC8yLjAsMS4wKSk7XCIsXG5cIiAgdmVjMyBjaG9zZW5HcmlkTGluZUNvbG9yID0gbWl4KGdyaWRMaW5lQ29sb3Ioc29saWRDb2xvci54eXopLCBncmlkQ29sb3IsIHVzZUN1c3RvbUdyaWRDb2xvcik7IFwiLCAvL3VzZSBlaXRoZXIgZ3JpZExpbmVDb2xvcigpIG9yIG92ZXJyaWRlIHdpdGggY3VzdG9tIGdyaWRcblwiICB2ZWMzIGJsZW5kZWRHcmlkTGluZSA9IHNob3dTb2xpZCAqIGNob3NlbkdyaWRMaW5lQ29sb3IgKyAoMS4wLXNob3dTb2xpZCkqc29saWRDb2xvci54eXo7XCIsIC8vaWYgc2hvd1NvbGlkID0wLCB1c2Ugc29saWRDb2xvciBhcyB0aGUgZ3JpZGxpbmUgY29sb3IsIG90aGVyd2lzZSBzaGFkZVxuXG5cIiAgaWYoIGRpc3RUb0VkZ2UueCA8IGxpbmVXaWR0aCB8fCBkaXN0VG9FZGdlLnkgPCBsaW5lV2lkdGgpe1wiLFxuXCIgICAgcmV0dXJuIG1peChleGlzdGluZ0NvbG9yLCB2ZWM0KGJsZW5kZWRHcmlkTGluZSwgMS4wKSxzaG93R3JpZCk7XCIsXG5cIiAgfVwiLFxuXCIgIHJldHVybiBleGlzdGluZ0NvbG9yO1wiLFxuXCJ9XCIsXG4vKlxuXCJ2ZWM0IGdldFNoYWRlZENvbG9yTWF0aGJveCh2ZWM0IHJnYmEpIHsgXCIsXG5cIiAgdmVjMyBjb2xvciA9IHJnYmEueHl6O1wiLFxuXCIgIHZlYzMgY29sb3IyID0gb2ZmU3BlY3VsYXIocmdiYS54eXopO1wiLFxuXG5cIiAgdmVjMyBub3JtYWwgPSBub3JtYWxpemUodk5vcm1hbCk7XCIsXG5cIiAgdmVjMyBsaWdodCA9IG5vcm1hbGl6ZSh2TGlnaHQpO1wiLFxuXCIgIHZlYzMgcG9zaXRpb24gPSBub3JtYWxpemUodlBvc2l0aW9uKTtcIixcblwiICBmbG9hdCBzaWRlICAgID0gZ2xfRnJvbnRGYWNpbmcgPyAtMS4wIDogMS4wO1wiLFxuXCIgIGZsb2F0IGNvc2luZSAgPSBzaWRlICogZG90KG5vcm1hbCwgbGlnaHQpO1wiLFxuXCIgIGZsb2F0IGRpZmZ1c2UgPSBtaXgobWF4KDAuMCwgY29zaW5lKSwgLjUgKyAuNSAqIGNvc2luZSwgLjEpO1wiLFxuXCIgICB2ZWMzICBoYWxmTGlnaHQgPSBub3JtYWxpemUobGlnaHQgKyBwb3NpdGlvbik7XCIsXG5cIlx0ZmxvYXQgY29zaW5lSGFsZiA9IG1heCgwLjAsIHNpZGUgKiBkb3Qobm9ybWFsLCBoYWxmTGlnaHQpKTtcIixcblwiXHRmbG9hdCBzcGVjdWxhciA9IHBvdyhjb3NpbmVIYWxmLCAxNi4wKTtcIixcblwiXHRyZXR1cm4gdmVjNChjb2xvciAqIChkaWZmdXNlICogLjkgKyAuMDUpICowLjAgKyAgLjI1ICogY29sb3IyICogc3BlY3VsYXIsIHJnYmEuYSk7XCIsXG5cIn1cIiwqL1xuXG5cInZvaWQgbWFpbigpe1wiLFxuLy9cIiAgLy9nbF9GcmFnQ29sb3IgPSB2ZWM0KHZOb3JtYWwueHl6LCAxLjApOyAvLyB2aWV3IGRlYnVnIG5vcm1hbHNcIixcbi8vXCIgIC8vaWYodk5vcm1hbC54IDwgMC4wKXtnbF9GcmFnQ29sb3IgPSB2ZWM0KG9mZlNwZWN1bGFyKGNvbG9yLnJnYiksIDEuMCk7fWVsc2V7Z2xfRnJhZ0NvbG9yID0gdmVjNCgoY29sb3IucmdiKSwgMS4wKTt9XCIsIC8vdmlldyBzcGVjdWxhciBhbmQgbm9uLXNwZWN1bGFyIGNvbG9yc1xuLy9cIiAgZ2xfRnJhZ0NvbG9yID0gdmVjNChtb2QodlV2Lnh5LDEuMCksMC4wLDEuMCk7IC8vc2hvdyB1dnNcblwiICB2ZWM0IHNvbGlkQ29sb3IgPSB2ZWM0KGNvbG9yLnJnYiwgc2hvd1NvbGlkKTtcIixcblwiICB2ZWM0IHNvbGlkQ29sb3JPdXQgPSBzaG93U29saWQqZ2V0U2hhZGVkQ29sb3Ioc29saWRDb2xvcik7XCIsXG5cIiAgdmVjNCBjb2xvcldpdGhHcmlkbGluZXMgPSByZW5kZXJHcmlkbGluZXMoc29saWRDb2xvck91dCwgdlV2Lnh5LCBzb2xpZENvbG9yKTtcIixcblwiICBjb2xvcldpdGhHcmlkbGluZXMuYSAqPSBvcGFjaXR5O1wiLFxuXCIgIGdsX0ZyYWdDb2xvciA9IGNvbG9yV2l0aEdyaWRsaW5lcztcIixcdFxuXCJ9XCJdLmpvaW4oXCJcXG5cIilcblxudmFyIHVuaWZvcm1zID0ge1xuXHR0aW1lOiB7XG5cdFx0dHlwZTogJ2YnLFxuXHRcdHZhbHVlOiAwLFxuXHR9LFxuXHRjb2xvcjoge1xuXHRcdHR5cGU6ICdjJyxcblx0XHR2YWx1ZTogbmV3IFRIUkVFLkNvbG9yKDB4NTVhYTU1KSxcblx0fSxcblx0dXNlQ3VzdG9tR3JpZENvbG9yOiB7XG5cdFx0dHlwZTogJ2YnLFxuXHRcdHZhbHVlOiAwLFxuXHR9LFxuXHRncmlkQ29sb3I6IHtcblx0XHR0eXBlOiAnYycsXG5cdFx0dmFsdWU6IG5ldyBUSFJFRS5Db2xvcigweDU1YWE1NSksXG5cdH0sXG5cdG9wYWNpdHk6IHtcblx0XHR0eXBlOiAnZicsXG5cdFx0dmFsdWU6IDAuMSxcblx0fSxcblx0dkxpZ2h0OiB7IC8vbGlnaHQgZGlyZWN0aW9uXG5cdFx0dHlwZTogJ3ZlYzMnLFxuXHRcdHZhbHVlOiBbMCwwLDFdLFxuXHR9LFxuXHRncmlkU3F1YXJlczoge1xuXHRcdHR5cGU6ICdmJyxcblx0XHR2YWx1ZTogNCxcblx0fSxcblx0bGluZVdpZHRoOiB7XG5cdFx0dHlwZTogJ2YnLFxuXHRcdHZhbHVlOiAwLjEsXG5cdH0sXG5cdHNob3dHcmlkOiB7XG5cdFx0dHlwZTogJ2YnLFxuXHRcdHZhbHVlOiAxLjAsXG5cdH0sXG5cdHNob3dTb2xpZDoge1xuXHRcdHR5cGU6ICdmJyxcblx0XHR2YWx1ZTogMS4wLFxuXHR9XG59O1xuXG5leHBvcnQgeyB2U2hhZGVyLCBmU2hhZGVyLCB1bmlmb3JtcyB9O1xuIiwiaW1wb3J0IHtPdXRwdXROb2RlfSBmcm9tICcuLi9Ob2RlLmpzJztcbmltcG9ydCB7TGluZU91dHB1dH0gZnJvbSAnLi9MaW5lT3V0cHV0LmpzJztcbmltcG9ydCB7IGdldFRocmVlRW52aXJvbm1lbnQgfSBmcm9tICcuLi9UaHJlZUVudmlyb25tZW50LmpzJztcbmltcG9ydCB7IHZTaGFkZXIsIGZTaGFkZXIsIHVuaWZvcm1zIH0gZnJvbSAnLi9TdXJmYWNlT3V0cHV0U2hhZGVycy5qcyc7XG5cbmNsYXNzIFN1cmZhY2VPdXRwdXQgZXh0ZW5kcyBPdXRwdXROb2Rle1xuXHRjb25zdHJ1Y3RvcihvcHRpb25zID0ge30pe1xuXHRcdHN1cGVyKCk7XG5cdFx0Lyogc2hvdWxkIGJlIC5hZGQoKWVkIHRvIGEgVHJhbnNmb3JtYXRpb24gdG8gd29ya1xuXHRcdFx0b3B0aW9uczpcblx0XHRcdHtcblx0XHRcdFx0b3BhY2l0eTogbnVtYmVyXG5cdFx0XHRcdGNvbG9yOiBoZXggY29kZSBvciBUSFJFRS5Db2xvcigpLiBEaWZmdXNlIGNvbG9yIG9mIHRoaXMgc3VyZmFjZS5cblx0XHRcdFx0Z3JpZENvbG9yOiBoZXggY29kZSBvciBUSFJFRS5Db2xvcigpLiBJZiBzaG93R3JpZCBpcyB0cnVlLCBncmlkIGxpbmVzIHdpbGwgYXBwZWFyIG92ZXIgdGhpcyBzdXJmYWNlLiBncmlkQ29sb3IgZGV0ZXJtaW5lcyB0aGVpciBjb2xvciBcblx0XHRcdFx0c2hvd0dyaWQ6IGJvb2xlYW4uIElmIHRydWUsIHdpbGwgZGlzcGxheSBhIGdyaWRDb2xvci1jb2xvcmVkIGdyaWQgb3ZlciB0aGUgc3VyZmFjZS4gRGVmYXVsdDogdHJ1ZVxuXHRcdFx0XHRzaG93U29saWQ6IGJvb2xlYW4uIElmIHRydWUsIHdpbGwgZGlzcGxheSBhIHNvbGlkIHN1cmZhY2UuIERlZmF1bHQ6IHRydWVcblx0XHRcdFx0Z3JpZFNxdWFyZXM6IG51bWJlciByZXByZXNlbnRpbmcgaG93IG1hbnkgc3F1YXJlcyBwZXIgZGltZW5zaW9uIHRvIHVzZSBpbiBhIHJlbmRlcmVkIGdyaWRcblx0XHRcdFx0Z3JpZExpbmVXaWR0aDogbnVtYmVyIHJlcHJlc2VudGluZyBob3cgbWFueSBzcXVhcmVzIHBlciBkaW1lbnNpb24gdG8gdXNlIGluIGEgcmVuZGVyZWQgZ3JpZFxuXHRcdFx0fVxuXHRcdCovXG5cdFx0dGhpcy5fb3BhY2l0eSA9IG9wdGlvbnMub3BhY2l0eSAhPT0gdW5kZWZpbmVkID8gb3B0aW9ucy5vcGFjaXR5IDogMTtcblxuXHRcdHRoaXMuX2NvbG9yID0gb3B0aW9ucy5jb2xvciAhPT0gdW5kZWZpbmVkID8gbmV3IFRIUkVFLkNvbG9yKG9wdGlvbnMuY29sb3IpIDogbmV3IFRIUkVFLkNvbG9yKDB4NTVhYTU1KTtcblxuXHRcdHRoaXMuX2dyaWRDb2xvciA9IG9wdGlvbnMuZ3JpZENvbG9yICE9PSB1bmRlZmluZWQgPyBuZXcgVEhSRUUuQ29sb3Iob3B0aW9ucy5ncmlkQ29sb3IpIDogbmV3IFRIUkVFLkNvbG9yKDB4NTVhYTU1KTtcbiAgICAgICAgdGhpcy5fdXNlQ3VzdG9tR3JpZENvbG9yID0gb3B0aW9ucy5ncmlkQ29sb3IgIT09IHVuZGVmaW5lZDtcblxuXHRcdHRoaXMuX2dyaWRTcXVhcmVzID0gb3B0aW9ucy5ncmlkU3F1YXJlcyAhPT0gdW5kZWZpbmVkID8gb3B0aW9ucy5ncmlkU3F1YXJlcyA6IDE2O1xuXHRcdHRoaXMuX3Nob3dHcmlkID0gb3B0aW9ucy5zaG93R3JpZCAhPT0gdW5kZWZpbmVkID8gb3B0aW9ucy5zaG93R3JpZCA6IHRydWU7XG5cdFx0dGhpcy5fc2hvd1NvbGlkID0gb3B0aW9ucy5zaG93U29saWQgIT09IHVuZGVmaW5lZCA/IG9wdGlvbnMuc2hvd1NvbGlkIDogdHJ1ZTtcblx0XHR0aGlzLl9ncmlkTGluZVdpZHRoID0gb3B0aW9ucy5ncmlkTGluZVdpZHRoICE9PSB1bmRlZmluZWQgPyBvcHRpb25zLmdyaWRMaW5lV2lkdGggOiAwLjE1O1xuXG5cdFx0dGhpcy5udW1DYWxsc1BlckFjdGl2YXRpb24gPSAwOyAvL3Nob3VsZCBhbHdheXMgYmUgZXF1YWwgdG8gdGhpcy52ZXJ0aWNlcy5sZW5ndGhcblx0XHR0aGlzLml0ZW1EaW1lbnNpb25zID0gW107IC8vIGhvdyBtYW55IHRpbWVzIHRvIGJlIGNhbGxlZCBpbiBlYWNoIGRpcmVjdGlvblxuXHRcdHRoaXMuX291dHB1dERpbWVuc2lvbnMgPSAzOyAvL2hvdyBtYW55IGRpbWVuc2lvbnMgcGVyIHBvaW50IHRvIHN0b3JlP1xuXG5cdFx0dGhpcy5pbml0KCk7XG5cdH1cblx0aW5pdCgpe1xuXHRcdHRoaXMuX2dlb21ldHJ5ID0gbmV3IFRIUkVFLkJ1ZmZlckdlb21ldHJ5KCk7XG5cdFx0dGhpcy5fdmVydGljZXM7XG5cdFx0dGhpcy5tYWtlR2VvbWV0cnkoKTtcblxuXHRcdC8vbWFrZSBhIGRlZXAgY29weSBvZiB0aGUgdW5pZm9ybXMgdGVtcGxhdGVcblx0XHR0aGlzLl91bmlmb3JtcyA9IHt9O1xuXHRcdGZvcih2YXIgdW5pZm9ybU5hbWUgaW4gdW5pZm9ybXMpe1xuXHRcdFx0dGhpcy5fdW5pZm9ybXNbdW5pZm9ybU5hbWVdID0ge1xuXHRcdFx0XHR0eXBlOiB1bmlmb3Jtc1t1bmlmb3JtTmFtZV0udHlwZSxcblx0XHRcdFx0dmFsdWU6IHVuaWZvcm1zW3VuaWZvcm1OYW1lXS52YWx1ZVxuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHRoaXMubWF0ZXJpYWwgPSBuZXcgVEhSRUUuU2hhZGVyTWF0ZXJpYWwoe1xuXHRcdFx0c2lkZTogVEhSRUUuQmFja1NpZGUsXG5cdFx0XHR2ZXJ0ZXhTaGFkZXI6IHZTaGFkZXIsIFxuXHRcdFx0ZnJhZ21lbnRTaGFkZXI6IGZTaGFkZXIsXG5cdFx0XHR1bmlmb3JtczogdGhpcy5fdW5pZm9ybXMsXG5cdFx0XHR9KTtcblx0XHR0aGlzLm1lc2ggPSBuZXcgVEhSRUUuTWVzaCh0aGlzLl9nZW9tZXRyeSx0aGlzLm1hdGVyaWFsKTtcblxuXHRcdHRoaXMub3BhY2l0eSA9IHRoaXMuX29wYWNpdHk7IC8vIHNldHRlciBzZXRzIHRyYW5zcGFyZW50IGZsYWcgaWYgbmVjZXNzYXJ5XG5cdFx0dGhpcy5jb2xvciA9IHRoaXMuX2NvbG9yOyAvL3NldHRlciBzZXRzIGNvbG9yIHVuaWZvcm1cblx0XHR0aGlzLl91bmlmb3Jtcy5vcGFjaXR5LnZhbHVlID0gdGhpcy5fb3BhY2l0eTtcblx0XHR0aGlzLl91bmlmb3Jtcy5ncmlkU3F1YXJlcy52YWx1ZSA9IHRoaXMuX2dyaWRTcXVhcmVzO1xuXHRcdHRoaXMuX3VuaWZvcm1zLnNob3dHcmlkLnZhbHVlID0gdGhpcy50b051bSh0aGlzLl9zaG93R3JpZCk7XG5cdFx0dGhpcy5fdW5pZm9ybXMuc2hvd1NvbGlkLnZhbHVlID0gdGhpcy50b051bSh0aGlzLl9zaG93U29saWQpO1xuXHRcdHRoaXMuX3VuaWZvcm1zLmxpbmVXaWR0aC52YWx1ZSA9IHRoaXMuX2dyaWRMaW5lV2lkdGg7XG4gICAgICAgIHRoaXMuX3VuaWZvcm1zLnVzZUN1c3RvbUdyaWRDb2xvciA9IHRoaXMuX3VzZUN1c3RvbUdyaWRDb2xvcjtcblxuXHRcdGlmKCF0aGlzLnNob3dTb2xpZCl0aGlzLm1hdGVyaWFsLnRyYW5zcGFyZW50ID0gdHJ1ZTtcblxuXHRcdGdldFRocmVlRW52aXJvbm1lbnQoKS5zY2VuZS5hZGQodGhpcy5tZXNoKTtcblx0fVxuICAgIHRvTnVtKHgpe1xuICAgICAgICBpZih4ID09IGZhbHNlKXJldHVybiAwO1xuICAgICAgICBpZih4ID09IHRydWUpcmV0dXJuIDE7XG4gICAgICAgIHJldHVybiB4O1xuICAgIH1cblx0bWFrZUdlb21ldHJ5KCl7XG5cblx0XHRsZXQgTUFYX1BPSU5UUyA9IDEwMDAwO1xuXG5cdFx0dGhpcy5fdmVydGljZXMgPSBuZXcgRmxvYXQzMkFycmF5KE1BWF9QT0lOVFMgKiB0aGlzLl9vdXRwdXREaW1lbnNpb25zKTtcblx0XHR0aGlzLl9ub3JtYWxzID0gbmV3IEZsb2F0MzJBcnJheShNQVhfUE9JTlRTICogMyk7XG5cdFx0dGhpcy5fdXZzID0gbmV3IEZsb2F0MzJBcnJheShNQVhfUE9JTlRTICogMik7XG5cblx0XHQvLyBidWlsZCBnZW9tZXRyeVxuXG5cdFx0dGhpcy5fZ2VvbWV0cnkuYWRkQXR0cmlidXRlKCAncG9zaXRpb24nLCBuZXcgVEhSRUUuRmxvYXQzMkJ1ZmZlckF0dHJpYnV0ZSggdGhpcy5fdmVydGljZXMsIHRoaXMuX291dHB1dERpbWVuc2lvbnMgKSApO1xuXHRcdHRoaXMuX2dlb21ldHJ5LmFkZEF0dHJpYnV0ZSggJ25vcm1hbCcsIG5ldyBUSFJFRS5GbG9hdDMyQnVmZmVyQXR0cmlidXRlKCB0aGlzLl9ub3JtYWxzLCAzICkgKTtcblx0XHR0aGlzLl9nZW9tZXRyeS5hZGRBdHRyaWJ1dGUoICd1dicsIG5ldyBUSFJFRS5GbG9hdDMyQnVmZmVyQXR0cmlidXRlKCB0aGlzLl91dnMsIDIgKSApO1xuXG5cdFx0dGhpcy5fY3VycmVudFBvaW50SW5kZXggPSAwOyAvL3VzZWQgZHVyaW5nIHVwZGF0ZXMgYXMgYSBwb2ludGVyIHRvIHRoZSBidWZmZXJcblxuXHRcdHRoaXMuX2FjdGl2YXRlZE9uY2UgPSBmYWxzZTtcblxuXHR9XG5cdF9zZXRVVnModXZzLCBpbmRleCwgdSwgdil7XG5cblx0fVxuXHRfb25GaXJzdEFjdGl2YXRpb24oKXtcbiAgICAgICAgLy9zZXR1cCB0aGlzLm51bUNhbGxzUGVyQWN0aXZhdGlvbiBhbmQgdGhpcy5pdGVtRGltZW5zaW9ucy4gdXNlZCBoZXJlIGFnYWluIGJlY2F1c2UgY2xvbmluZyBtZWFucyB0aGUgb25BZGQoKSBtaWdodCBiZSBjYWxsZWQgYmVmb3JlIHRoaXMgaXMgY29ubmVjdGVkIHRvIGEgdHlwZSBvZiBkb21haW5cblxuXHRcdC8vY2xpbWIgdXAgcGFyZW50IGhpZXJhcmNoeSB0byBmaW5kIHRoZSBEb21haW5Ob2RlIHdlJ3JlIHJlbmRlcmluZyBmcm9tXG5cdFx0bGV0IHJvb3QgPSB0aGlzLmdldENsb3Nlc3REb21haW4oKTtcblx0XHR0aGlzLm51bUNhbGxzUGVyQWN0aXZhdGlvbiA9IHJvb3QubnVtQ2FsbHNQZXJBY3RpdmF0aW9uO1xuXHRcdHRoaXMuaXRlbURpbWVuc2lvbnMgPSByb290Lml0ZW1EaW1lbnNpb25zO1xuXG5cdFx0Ly8gcGVyaGFwcyBpbnN0ZWFkIG9mIGdlbmVyYXRpbmcgYSB3aG9sZSBuZXcgYXJyYXksIHRoaXMgY2FuIHJldXNlIHRoZSBvbGQgb25lP1xuXHRcdGxldCB2ZXJ0aWNlcyA9IG5ldyBGbG9hdDMyQXJyYXkodGhpcy5udW1DYWxsc1BlckFjdGl2YXRpb24gKiB0aGlzLl9vdXRwdXREaW1lbnNpb25zKTtcblx0XHRsZXQgbm9ybWFscyA9IG5ldyBGbG9hdDMyQXJyYXkodGhpcy5udW1DYWxsc1BlckFjdGl2YXRpb24gKiAzKTtcblx0XHRsZXQgdXZzID0gbmV3IEZsb2F0MzJBcnJheSh0aGlzLm51bUNhbGxzUGVyQWN0aXZhdGlvbiAqIDIpO1xuXG5cdFx0bGV0IHBvc2l0aW9uQXR0cmlidXRlID0gdGhpcy5fZ2VvbWV0cnkuYXR0cmlidXRlcy5wb3NpdGlvbjtcblx0XHR0aGlzLl92ZXJ0aWNlcyA9IHZlcnRpY2VzO1xuXHRcdHBvc2l0aW9uQXR0cmlidXRlLnNldEFycmF5KHRoaXMuX3ZlcnRpY2VzKTtcblx0XHRwb3NpdGlvbkF0dHJpYnV0ZS5uZWVkc1VwZGF0ZSA9IHRydWU7XG5cblx0XHRsZXQgbm9ybWFsQXR0cmlidXRlID0gdGhpcy5fZ2VvbWV0cnkuYXR0cmlidXRlcy5ub3JtYWw7XG5cdFx0dGhpcy5fbm9ybWFscyA9IG5vcm1hbHM7XG5cdFx0bm9ybWFsQXR0cmlidXRlLnNldEFycmF5KHRoaXMuX25vcm1hbHMpO1xuXHRcdG5vcm1hbEF0dHJpYnV0ZS5uZWVkc1VwZGF0ZSA9IHRydWU7XG5cblx0XHRsZXQgdXZBdHRyaWJ1dGUgPSB0aGlzLl9nZW9tZXRyeS5hdHRyaWJ1dGVzLnV2O1xuXG5cblx0XHQvL2Fzc2VydCB0aGlzLml0ZW1EaW1lbnNpb25zWzBdICogdGhpcy5pdGVtRGltZW5zaW9uc1sxXSA9IHRoaXMubnVtQ2FsbHNQZXJBY3RpdmF0aW9uIGFuZCB0aGlzLl9vdXRwdXREaW1lbnNpb25zID09IDJcblx0XHR2YXIgaW5kaWNlcyA9IFtdO1xuXG5cdFx0Ly9yZW5kZXJlZCB0cmlhbmdsZSBpbmRpY2VzXG5cdFx0Ly9mcm9tIHRocmVlLmpzIFBsYW5lR2VvbWV0cnkuanNcblx0XHRsZXQgYmFzZSA9IDA7XG5cdFx0bGV0IGk9MCwgaj0wO1xuXHRcdGZvcihqPTA7ajx0aGlzLml0ZW1EaW1lbnNpb25zWzBdLTE7aisrKXtcblx0XHRcdGZvcihpPTA7aTx0aGlzLml0ZW1EaW1lbnNpb25zWzFdLTE7aSsrKXtcblxuXHRcdFx0XHRsZXQgYSA9IGkgKyBqICogdGhpcy5pdGVtRGltZW5zaW9uc1sxXTtcblx0XHRcdFx0bGV0IGIgPSBpICsgKGorMSkgKiB0aGlzLml0ZW1EaW1lbnNpb25zWzFdO1xuXHRcdFx0XHRsZXQgYyA9IChpKzEpKyAoaisxKSAqIHRoaXMuaXRlbURpbWVuc2lvbnNbMV07XG5cdFx0XHRcdGxldCBkID0gKGkrMSkrIGogKiB0aGlzLml0ZW1EaW1lbnNpb25zWzFdO1xuXG4gICAgICAgIFx0XHRpbmRpY2VzLnB1c2goYSwgYiwgZCk7XG5cdFx0XHRcdGluZGljZXMucHVzaChiLCBjLCBkKTtcblx0XHRcdFx0XG5cdFx0XHRcdC8vZG91YmxlIHNpZGVkIHJldmVyc2UgZmFjZXNcbiAgICAgICAgXHRcdGluZGljZXMucHVzaChkLCBiLCBhKTtcblx0XHRcdFx0aW5kaWNlcy5wdXNoKGQsIGMsIGIpO1xuXG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0Ly9ub3JtYWxzICh3aWxsIGJlIG92ZXJ3cml0dGVuIGxhdGVyKSBhbmQgdXZzXG5cdFx0Zm9yKGo9MDtqPHRoaXMuaXRlbURpbWVuc2lvbnNbMF07aisrKXtcblx0XHRcdGZvcihpPTA7aTx0aGlzLml0ZW1EaW1lbnNpb25zWzFdO2krKyl7XG5cblx0XHRcdFx0bGV0IHBvaW50SW5kZXggPSBpICsgaiAqIHRoaXMuaXRlbURpbWVuc2lvbnNbMV07XG5cdFx0XHRcdC8vc2V0IG5vcm1hbCB0byBbMCwwLDFdIGFzIGEgdGVtcG9yYXJ5IHZhbHVlXG5cdFx0XHRcdG5vcm1hbHNbKHBvaW50SW5kZXgpKjNdID0gMDtcblx0XHRcdFx0bm9ybWFsc1socG9pbnRJbmRleCkqMysxXSA9IDA7XG5cdFx0XHRcdG5vcm1hbHNbKHBvaW50SW5kZXgpKjMrMl0gPSAxO1xuXG5cdFx0XHRcdC8vdXZzXG5cdFx0XHRcdHV2c1socG9pbnRJbmRleCkqMl0gPSBqLyh0aGlzLml0ZW1EaW1lbnNpb25zWzBdLTEpO1xuXHRcdFx0XHR1dnNbKHBvaW50SW5kZXgpKjIrMV0gPSBpLyh0aGlzLml0ZW1EaW1lbnNpb25zWzFdLTEpO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHRoaXMuX3V2cyA9IHV2cztcblx0XHR1dkF0dHJpYnV0ZS5zZXRBcnJheSh0aGlzLl91dnMpO1xuXHRcdHV2QXR0cmlidXRlLm5lZWRzVXBkYXRlID0gdHJ1ZTtcblxuXHRcdHRoaXMuX2dlb21ldHJ5LnNldEluZGV4KCBpbmRpY2VzICk7XG5cdH1cblx0ZXZhbHVhdGVTZWxmKGksIHQsIHgsIHksIHope1xuXHRcdGlmKCF0aGlzLl9hY3RpdmF0ZWRPbmNlKXtcblx0XHRcdHRoaXMuX2FjdGl2YXRlZE9uY2UgPSB0cnVlO1xuXHRcdFx0dGhpcy5fb25GaXJzdEFjdGl2YXRpb24oKTtcdFxuXHRcdH1cblxuXHRcdC8vaXQncyBhc3N1bWVkIGkgd2lsbCBnbyBmcm9tIDAgdG8gdGhpcy5udW1DYWxsc1BlckFjdGl2YXRpb24sIHNpbmNlIHRoaXMgc2hvdWxkIG9ubHkgYmUgY2FsbGVkIGZyb20gYW4gQXJlYS5cblxuXHRcdC8vYXNzZXJ0IGkgPCB2ZXJ0aWNlcy5jb3VudFxuXG5cdFx0bGV0IGluZGV4ID0gdGhpcy5fY3VycmVudFBvaW50SW5kZXgqdGhpcy5fb3V0cHV0RGltZW5zaW9ucztcblxuXHQgICAgdGhpcy5fdmVydGljZXNbaW5kZXhdICAgPSB4ID09PSB1bmRlZmluZWQgPyAwIDogeDtcblx0XHR0aGlzLl92ZXJ0aWNlc1tpbmRleCsxXSA9IHkgPT09IHVuZGVmaW5lZCA/IDAgOiB5O1xuXHRcdHRoaXMuX3ZlcnRpY2VzW2luZGV4KzJdID0geiA9PT0gdW5kZWZpbmVkID8gMCA6IHo7XG5cblx0XHR0aGlzLl9jdXJyZW50UG9pbnRJbmRleCsrO1xuXHR9XG5cdG9uQWZ0ZXJBY3RpdmF0aW9uKCl7XG5cdFx0bGV0IHBvc2l0aW9uQXR0cmlidXRlID0gdGhpcy5fZ2VvbWV0cnkuYXR0cmlidXRlcy5wb3NpdGlvbjtcblx0XHRwb3NpdGlvbkF0dHJpYnV0ZS5uZWVkc1VwZGF0ZSA9IHRydWU7XG5cblx0XHR0aGlzLl9yZWNhbGNOb3JtYWxzKCk7XG5cdFx0bGV0IG5vcm1hbEF0dHJpYnV0ZSA9IHRoaXMuX2dlb21ldHJ5LmF0dHJpYnV0ZXMubm9ybWFsO1xuXHRcdG5vcm1hbEF0dHJpYnV0ZS5uZWVkc1VwZGF0ZSA9IHRydWU7XG5cblx0XHR0aGlzLl9jdXJyZW50UG9pbnRJbmRleCA9IDA7IC8vcmVzZXQgYWZ0ZXIgZWFjaCB1cGRhdGVcblx0fVxuXHRfcmVjYWxjTm9ybWFscygpe1xuXHRcdGxldCBwb3NpdGlvbkF0dHJpYnV0ZSA9IHRoaXMuX2dlb21ldHJ5LmF0dHJpYnV0ZXMucG9zaXRpb247XG5cdFx0bGV0IG5vcm1hbEF0dHJpYnV0ZSA9IHRoaXMuX2dlb21ldHJ5LmF0dHJpYnV0ZXMubm9ybWFsO1xuXHRcdC8vcmVuZGVyZWQgdHJpYW5nbGUgaW5kaWNlc1xuXHRcdC8vZnJvbSB0aHJlZS5qcyBQbGFuZUdlb21ldHJ5LmpzXG5cdFx0bGV0IG5vcm1hbFZlYyA9IG5ldyBUSFJFRS5WZWN0b3IzKCk7XG5cdFx0bGV0IHBhcnRpYWxYID0gbmV3IFRIUkVFLlZlY3RvcjMoKTtcblx0XHRsZXQgcGFydGlhbFkgPSBuZXcgVEhSRUUuVmVjdG9yMygpO1xuXG5cdFx0bGV0IGJhc2UgPSAwO1xuXHRcdGxldCBuZWdhdGlvbkZhY3RvciA9IDE7XG5cdFx0bGV0IGk9MCwgaj0wO1xuXHRcdGZvcihqPTA7ajx0aGlzLml0ZW1EaW1lbnNpb25zWzBdO2orKyl7XG5cdFx0XHRmb3IoaT0wO2k8dGhpcy5pdGVtRGltZW5zaW9uc1sxXTtpKyspe1xuXG5cdFx0XHRcdC8vY3VycmVudGx5IGRvaW5nIHRoZSBub3JtYWwgZm9yIHRoZSBwb2ludCBhdCBpbmRleCBhLlxuXHRcdFx0XHRsZXQgYSA9IGkgKyBqICogdGhpcy5pdGVtRGltZW5zaW9uc1sxXTtcblx0XHRcdFx0bGV0IGIsYztcblxuXHRcdFx0XHQvL1RhbmdlbnRzIGFyZSBjYWxjdWxhdGVkIHdpdGggZmluaXRlIGRpZmZlcmVuY2VzIC0gRm9yICh4LHkpLCBjb21wdXRlIHRoZSBwYXJ0aWFsIGRlcml2YXRpdmVzIHVzaW5nICh4KzEseSkgYW5kICh4LHkrMSkgYW5kIGNyb3NzIHRoZW0uIEJ1dCBpZiB5b3UncmUgYXQgdGhlYm9yZGVyLCB4KzEgYW5kIHkrMSBtaWdodCBub3QgZXhpc3QuIFNvIGluIHRoYXQgY2FzZSB3ZSBnbyBiYWNrd2FyZHMgYW5kIHVzZSAoeC0xLHkpIGFuZCAoeCx5LTEpIGluc3RlYWQuXG5cdFx0XHRcdC8vV2hlbiB0aGF0IGhhcHBlbnMsIHRoZSB2ZWN0b3Igc3VidHJhY3Rpb24gd2lsbCBzdWJ0cmFjdCB0aGUgd3Jvbmcgd2F5LCBpbnRyb2R1Y2luZyBhIGZhY3RvciBvZiAtMSBpbnRvIHRoZSBjcm9zcyBwcm9kdWN0IHRlcm0uIFNvIG5lZ2F0aW9uRmFjdG9yIGtlZXBzIHRyYWNrIG9mIHdoZW4gdGhhdCBoYXBwZW5zIGFuZCBpcyBtdWx0aXBsaWVkIGFnYWluIHRvIGNhbmNlbCBpdCBvdXQuXG5cdFx0XHRcdG5lZ2F0aW9uRmFjdG9yID0gMTsgXG5cblx0XHRcdFx0Ly9iIGlzIHRoZSBpbmRleCBvZiB0aGUgcG9pbnQgMSBhd2F5IGluIHRoZSB5IGRpcmVjdGlvblxuXHRcdFx0XHRpZihpIDwgdGhpcy5pdGVtRGltZW5zaW9uc1sxXS0xKXtcblx0XHRcdFx0XHRiID0gKGkrMSkgKyBqICogdGhpcy5pdGVtRGltZW5zaW9uc1sxXTtcblx0XHRcdFx0fWVsc2V7XG5cdFx0XHRcdFx0Ly9lbmQgb2YgdGhlIHkgYXhpcywgZ28gYmFja3dhcmRzIGZvciB0YW5nZW50c1xuXHRcdFx0XHRcdGIgPSAoaS0xKSArIGogKiB0aGlzLml0ZW1EaW1lbnNpb25zWzFdO1xuXHRcdFx0XHRcdG5lZ2F0aW9uRmFjdG9yICo9IC0xO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0Ly9jIGlzIHRoZSBpbmRleCBvZiB0aGUgcG9pbnQgMSBhd2F5IGluIHRoZSB4IGRpcmVjdGlvblxuXHRcdFx0XHRpZihqIDwgdGhpcy5pdGVtRGltZW5zaW9uc1swXS0xKXtcblx0XHRcdFx0XHRjID0gaSArIChqKzEpICogdGhpcy5pdGVtRGltZW5zaW9uc1sxXTtcblx0XHRcdFx0fWVsc2V7XG5cdFx0XHRcdFx0Ly9lbmQgb2YgdGhlIHggYXhpcywgZ28gYmFja3dhcmRzIGZvciB0YW5nZW50c1xuXHRcdFx0XHRcdGMgPSBpICsgKGotMSkgKiB0aGlzLml0ZW1EaW1lbnNpb25zWzFdO1xuXHRcdFx0XHRcdG5lZ2F0aW9uRmFjdG9yICo9IC0xO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0Ly90aGUgdmVjdG9yIGItYS4gXG5cdFx0XHRcdC8vdGhpcy5fdmVydGljZXMgc3RvcmVzIHRoZSBjb21wb25lbnRzIG9mIGVhY2ggdmVjdG9yIGluIG9uZSBiaWcgZmxvYXQzMmFycmF5LCBzbyB0aGlzIHB1bGxzIHRoZW0gb3V0IGFuZCBqdXN0IGRvZXMgdGhlIHN1YnRyYWN0aW9uIG51bWVyaWNhbGx5LiBUaGUgY29tcG9uZW50cyBvZiB2ZWN0b3IgIzUyIGFyZSB4OjUyKjMrMCx5OjUyKjMrMSx6OjUyKjMrMiwgZm9yIGV4YW1wbGUuXG5cdFx0XHRcdHBhcnRpYWxZLnNldCh0aGlzLl92ZXJ0aWNlc1tiKjNdLXRoaXMuX3ZlcnRpY2VzW2EqM10sdGhpcy5fdmVydGljZXNbYiozKzFdLXRoaXMuX3ZlcnRpY2VzW2EqMysxXSx0aGlzLl92ZXJ0aWNlc1tiKjMrMl0tdGhpcy5fdmVydGljZXNbYSozKzJdKTtcblx0XHRcdFx0Ly90aGUgdmVjdG9yIGMtYS5cblx0XHRcdFx0cGFydGlhbFguc2V0KHRoaXMuX3ZlcnRpY2VzW2MqM10tdGhpcy5fdmVydGljZXNbYSozXSx0aGlzLl92ZXJ0aWNlc1tjKjMrMV0tdGhpcy5fdmVydGljZXNbYSozKzFdLHRoaXMuX3ZlcnRpY2VzW2MqMysyXS10aGlzLl92ZXJ0aWNlc1thKjMrMl0pO1xuXG5cdFx0XHRcdC8vYi1hIGNyb3NzIGMtYVxuXHRcdFx0XHRub3JtYWxWZWMuY3Jvc3NWZWN0b3JzKHBhcnRpYWxYLHBhcnRpYWxZKS5ub3JtYWxpemUoKTtcblx0XHRcdFx0bm9ybWFsVmVjLm11bHRpcGx5U2NhbGFyKG5lZ2F0aW9uRmFjdG9yKTtcblx0XHRcdFx0Ly9zZXQgbm9ybWFsXG5cdFx0XHRcdHRoaXMuX25vcm1hbHNbKGkgKyBqICogdGhpcy5pdGVtRGltZW5zaW9uc1sxXSkqM10gPSBub3JtYWxWZWMueDtcblx0XHRcdFx0dGhpcy5fbm9ybWFsc1soaSArIGogKiB0aGlzLml0ZW1EaW1lbnNpb25zWzFdKSozKzFdID0gbm9ybWFsVmVjLnk7XG5cdFx0XHRcdHRoaXMuX25vcm1hbHNbKGkgKyBqICogdGhpcy5pdGVtRGltZW5zaW9uc1sxXSkqMysyXSA9IG5vcm1hbFZlYy56O1xuXHRcdFx0fVxuXHRcdH1cblx0XHQvLyBkb24ndCBmb3JnZXQgdG8gbm9ybWFsQXR0cmlidXRlLm5lZWRzVXBkYXRlID0gdHJ1ZSBhZnRlciBjYWxsaW5nIHRoaXMhXG5cdH1cbiAgICByZW1vdmVTZWxmRnJvbVNjZW5lKCl7XG4gICAgICAgIHRocmVlRW52aXJvbm1lbnQuc2NlbmUucmVtb3ZlKHRoaXMubWVzaCk7XG4gICAgfVxuXHRzZXQgY29sb3IoY29sb3Ipe1xuXHRcdC8vY3VycmVudGx5IG9ubHkgYSBzaW5nbGUgY29sb3IgaXMgc3VwcG9ydGVkLlxuXHRcdC8vSSBzaG91bGQgcmVhbGx5IG1ha2UgdGhpcyBhIGZ1bmN0aW9uXG5cdFx0dGhpcy5fY29sb3IgPSBjb2xvcjtcblx0XHR0aGlzLl91bmlmb3Jtcy5jb2xvci52YWx1ZSA9IG5ldyBUSFJFRS5Db2xvcihjb2xvcik7XG5cdH1cblx0Z2V0IGNvbG9yKCl7XG5cdFx0cmV0dXJuIHRoaXMuX2NvbG9yO1xuXHR9XG5cdHNldCBncmlkQ29sb3IoY29sb3Ipe1xuXHRcdC8vY3VycmVudGx5IG9ubHkgYSBzaW5nbGUgY29sb3IgaXMgc3VwcG9ydGVkLlxuXHRcdC8vSSBzaG91bGQgcmVhbGx5IG1ha2UgdGhpcyBhIGZ1bmN0aW9uXG5cdFx0dGhpcy5fZ3JpZENvbG9yID0gY29sb3I7XG5cdFx0dGhpcy5fdW5pZm9ybXMuZ3JpZENvbG9yLnZhbHVlID0gbmV3IFRIUkVFLkNvbG9yKGNvbG9yKTtcbiAgICAgICAgdGhpcy5fdW5pZm9ybXMudXNlQ3VzdG9tR3JpZENvbG9yID0gMS4wO1xuXHR9XG5cdGdldCBncmlkQ29sb3IoKXtcblx0XHRyZXR1cm4gdGhpcy5fZ3JpZENvbG9yO1xuXHR9XG5cdHNldCBvcGFjaXR5KG9wYWNpdHkpe1xuXHRcdHRoaXMubWF0ZXJpYWwub3BhY2l0eSA9IG9wYWNpdHk7XG5cdFx0dGhpcy5tYXRlcmlhbC50cmFuc3BhcmVudCA9IChvcGFjaXR5IDwgMSkgfHwgKCF0aGlzLnNob3dTb2xpZCk7XG5cdFx0dGhpcy5tYXRlcmlhbC52aXNpYmxlID0gb3BhY2l0eSA+IDA7XG5cdFx0dGhpcy5fb3BhY2l0eSA9IG9wYWNpdHk7XG4gICAgICAgIHRoaXMuX3VuaWZvcm1zLm9wYWNpdHkudmFsdWUgPSBvcGFjaXR5O1xuXHR9XG5cdGdldCBvcGFjaXR5KCl7XG5cdFx0cmV0dXJuIHRoaXMuX29wYWNpdHk7XG5cdH1cblx0Y2xvbmUoKXtcblx0XHRyZXR1cm4gbmV3IFN1cmZhY2VPdXRwdXQoe2NvbG9yOiB0aGlzLmNvbG9yLCBvcGFjaXR5OiB0aGlzLm9wYWNpdHl9KTtcblx0fVxufVxuXG5leHBvcnQge1N1cmZhY2VPdXRwdXR9O1xuIiwiaW1wb3J0IHtPdXRwdXROb2RlfSBmcm9tICcuLi9Ob2RlLmpzJztcblxuY2xhc3MgRmxhdEFycmF5T3V0cHV0IGV4dGVuZHMgT3V0cHV0Tm9kZXtcbiAgICAvL2FuIG91dHB1dCB3aGljaCBmaWxscyBhbiBhcnJheSB3aXRoIGV2ZXJ5IGNvb3JkaW5hdGUgcmVjaWV2ZWQsIGluIG9yZGVyLlxuICAgIC8vSXQnbGwgcmVnaXN0ZXIgWzAsMSwyXSxbMyw0LDVdIGFzIFswLDEsMiwzLDQsNV0uXG5cdGNvbnN0cnVjdG9yKG9wdGlvbnMgPSB7fSl7XG5cdFx0c3VwZXIoKTtcblx0XHQvKlxuXHRcdFx0YXJyYXk6IGFuIGV4aXN0aW5nIGFycmF5LCB3aGljaCB3aWxsIHRoZW4gYmUgbW9kaWZpZWQgaW4gcGxhY2UgZXZlcnkgdGltZSB0aGlzIG91dHB1dCBpcyBhY3RpdmF0ZWRcblx0XHQqL1xuXG5cdFx0dGhpcy5hcnJheSA9IG9wdGlvbnMuYXJyYXk7XG4gICAgICAgIHRoaXMuX2N1cnJlbnRBcnJheUluZGV4ID0gMDtcblx0fVxuXHRldmFsdWF0ZVNlbGYoaSwgdCwgLi4uY29vcmRzKXtcbiAgICAgICAgZm9yKHZhciBqPTA7ajxjb29yZHMubGVuZ3RoO2orKyl7IFxuICAgICAgICAgICAgLy9JIGRvbid0IG5lZWQgdG8gd29ycnkgYWJvdXQgb3V0LW9mLWJvdW5kcyBlbnRyaWVzIGJlY2F1c2UgamF2YXNjcmlwdCBhdXRvbWF0aWNhbGx5IGdyb3dzIGFycmF5cyBpZiBhIG5ldyBpbmRleCBpcyBzZXQuXG4gICAgICAgICAgICAvL0phdmFzY3JpcHQgbWF5IGhhdmUgc29tZSBnYXJiYWdlIGRlc2lnbiBjaG9pY2VzLCBidXQgSSdsbCBjbGFpbSB0aGF0IGdhcmJhZ2UgZm9yIG15IG93biBuZWZhcmlvdXMgYWR2YW50YWdlLlxuICAgICAgICAgICAgdGhpcy5hcnJheVt0aGlzLl9jdXJyZW50QXJyYXlJbmRleF0gPSBjb29yZHNbal1cbiAgICAgICAgICAgIHRoaXMuX2N1cnJlbnRBcnJheUluZGV4Kys7XG4gICAgICAgIH1cblx0fVxuXHRvbkFmdGVyQWN0aXZhdGlvbigpe1xuICAgICAgICB0aGlzLl9jdXJyZW50QXJyYXlJbmRleCA9IDA7XG5cdH1cblx0Y2xvbmUoKXtcblx0XHRyZXR1cm4gbmV3IEZsYXRBcnJheU91dHB1dCh7YXJyYXk6IEVYUC5NYXRoLmNsb25lKHRoaXMuYXJyYXkpfSk7XG5cdH1cbn1cblxuZXhwb3J0IHtGbGF0QXJyYXlPdXRwdXR9O1xuIiwidmFyIGV4cGxhbmFyaWFuQXJyb3dTVkcgPSBcImRhdGE6aW1hZ2Uvc3ZnK3htbDtiYXNlNjQsUEQ5NGJXd2dkbVZ5YzJsdmJqMGlNUzR3SWlCbGJtTnZaR2x1WnowaVZWUkdMVGdpSUhOMFlXNWtZV3h2Ym1VOUltNXZJajgrQ2p3aExTMGdRM0psWVhSbFpDQjNhWFJvSUVsdWEzTmpZWEJsSUNob2RIUndPaTh2ZDNkM0xtbHVhM05qWVhCbExtOXlaeThwSUMwdFBnb0tQSE4yWndvZ0lDQjRiV3h1Y3pwa1l6MGlhSFIwY0RvdkwzQjFjbXd1YjNKbkwyUmpMMlZzWlcxbGJuUnpMekV1TVM4aUNpQWdJSGh0Ykc1ek9tTmpQU0pvZEhSd09pOHZZM0psWVhScGRtVmpiMjF0YjI1ekxtOXlaeTl1Y3lNaUNpQWdJSGh0Ykc1ek9uSmtaajBpYUhSMGNEb3ZMM2QzZHk1M015NXZjbWN2TVRrNU9TOHdNaTh5TWkxeVpHWXRjM2x1ZEdGNExXNXpJeUlLSUNBZ2VHMXNibk02YzNablBTSm9kSFJ3T2k4dmQzZDNMbmN6TG05eVp5OHlNREF3TDNOMlp5SUtJQ0FnZUcxc2JuTTlJbWgwZEhBNkx5OTNkM2N1ZHpNdWIzSm5Mekl3TURBdmMzWm5JZ29nSUNCNGJXeHVjenA0YkdsdWF6MGlhSFIwY0RvdkwzZDNkeTUzTXk1dmNtY3ZNVGs1T1M5NGJHbHVheUlLSUNBZ2VHMXNibk02YzI5a2FYQnZaR2s5SW1oMGRIQTZMeTl6YjJScGNHOWthUzV6YjNWeVkyVm1iM0puWlM1dVpYUXZSRlJFTDNOdlpHbHdiMlJwTFRBdVpIUmtJZ29nSUNCNGJXeHVjenBwYm10elkyRndaVDBpYUhSMGNEb3ZMM2QzZHk1cGJtdHpZMkZ3WlM1dmNtY3ZibUZ0WlhOd1lXTmxjeTlwYm10elkyRndaU0lLSUNBZ2QybGtkR2c5SWpJd01DSUtJQ0FnYUdWcFoyaDBQU0l4TXpBaUNpQWdJSFpwWlhkQ2IzZzlJakFnTUNBeU1EQWdNVE13SWdvZ0lDQnBaRDBpYzNabk1pSUtJQ0FnZG1WeWMybHZiajBpTVM0eElnb2dJQ0JwYm10elkyRndaVHAyWlhKemFXOXVQU0l3TGpreElISXhNemN5TlNJS0lDQWdjMjlrYVhCdlpHazZaRzlqYm1GdFpUMGlSWGh3YkdGdVlYSnBZVzVPWlhoMFFYSnliM2N1YzNabklqNEtJQ0E4WkdWbWN6NEtQSEpoWkdsaGJFZHlZV1JwWlc1MElHbGtQU0poSWlCamVEMGlOVEF3SWlCamVUMGlOakkzTGpjeElpQnlQU0l5TkRJdU16VWlJR2R5WVdScFpXNTBWSEpoYm5ObWIzSnRQU0p0WVhSeWFYZ29NQ0F1TWprM01ESWdMVE11T0RNNU1TQXRNUzR4T1RNeFpTMDRJREkwTURndU1TQTRNemd1T0RVcElpQm5jbUZrYVdWdWRGVnVhWFJ6UFNKMWMyVnlVM0JoWTJWUGJsVnpaU0krQ2p4emRHOXdJSE4wYjNBdFkyOXNiM0k5SWlOaVl6Y3pNVGtpSUc5bVpuTmxkRDBpTUNJdlBnbzhjM1J2Y0NCemRHOXdMV052Ykc5eVBTSWpaakJrTWpZeklpQnZabVp6WlhROUlqRWlMejRLUEM5eVlXUnBZV3hIY21Ga2FXVnVkRDRLUEM5a1pXWnpQZ284YldWMFlXUmhkR0UrQ2p4eVpHWTZVa1JHUGdvOFkyTTZWMjl5YXlCeVpHWTZZV0p2ZFhROUlpSStDanhrWXpwbWIzSnRZWFErYVcxaFoyVXZjM1puSzNodGJEd3ZaR002Wm05eWJXRjBQZ284WkdNNmRIbHdaU0J5WkdZNmNtVnpiM1Z5WTJVOUltaDBkSEE2THk5d2RYSnNMbTl5Wnk5a1l5OWtZMjFwZEhsd1pTOVRkR2xzYkVsdFlXZGxJaTgrQ2p4a1l6cDBhWFJzWlM4K0Nqd3ZZMk02VjI5eWF6NEtQQzl5WkdZNlVrUkdQZ284TDIxbGRHRmtZWFJoUGdvOFp5QjBjbUZ1YzJadmNtMDlJblJ5WVc1emJHRjBaU2d3SUMwNU1qSXVNellwSWo0S1BIQmhkR2dnWkQwaWJURTVOeTQwTnlBNU9EY3VNelpqTUMweU5DNHlPREV0T0RjdU1qWXhMVFl4TGpjd09DMDROeTR5TmpFdE5qRXVOekE0ZGpJNUxqWTVOR3d0TVRNdU5UWXpJREF1TXpjNU5HTXRNVE11TlRZeklEQXVNemM1TXprdE5qSXVNakF5SURJdU9ESTNNUzAzTkM0NE1URWdOeTQ1TmpVM0xURXlMall3T1NBMUxqRXpPRFl0TVRrdU16QXhJREUwTGpZNU5TMHhPUzR6TURFZ01qTXVOalk1SURBZ09DNDVOek00SURNdU9UY3pOU0F4T0M0eE5qTWdNVGt1TXpBeElESXpMalkyT1NBeE5TNHpNamNnTlM0MU1EVTFJRFl4TGpJME9DQTNMalU0TmpNZ056UXVPREV4SURjdU9UWTFOMnd4TXk0MU5qTWdNQzR6TnprMGRqSTVMalk1TkhNNE55NHlOakV0TXpjdU5ESTRJRGczTGpJMk1TMDJNUzQzTURoNklpQm1hV3hzUFNKMWNtd29JMkVwSWlCemRISnZhMlU5SWlNM016VTFNMlFpSUhOMGNtOXJaUzEzYVdSMGFEMGlNaTQyTWpnMUlpOCtDanhuSUhSeVlXNXpabTl5YlQwaWJXRjBjbWw0S0RBZ0xqSTJNamcxSUMwdU1qWXlPRFVnTUNBeE56Z3VNVE1nT0RZd0xqQXhLU0lnYzNSeWIydGxQU0lqTURBd0lpQnpkSEp2YTJVdGQybGtkR2c5SWpFd0lqNEtQR1ZzYkdsd2MyVWdZM2c5SWpVME55NHhOQ0lnWTNrOUlqRXlNQzQ1TXlJZ2NuZzlJakkxTGpjeE5DSWdjbms5SWpVeExqUXlPU0lnWm1sc2JEMGlJMlptWmlJdlBnbzhaV3hzYVhCelpTQmplRDBpTlRNMExqTTNJaUJqZVQwaU1USXpMalV6SWlCeWVEMGlNVEl1TmpJM0lpQnllVDBpTWpZdU1qWTBJaTgrQ2p3dlp6NEtQR2NnZEhKaGJuTm1iM0p0UFNKdFlYUnlhWGdvTUNBdExqSTJNamcxSUMwdU1qWXlPRFVnTUNBeE56Z3VOallnTVRFeE5DNDNLU0lnYzNSeWIydGxQU0lqTURBd0lpQnpkSEp2YTJVdGQybGtkR2c5SWpFd0lqNEtQR1ZzYkdsd2MyVWdZM2c5SWpVME55NHhOQ0lnWTNrOUlqRXlNQzQ1TXlJZ2NuZzlJakkxTGpjeE5DSWdjbms5SWpVeExqUXlPU0lnWm1sc2JEMGlJMlptWmlJdlBnbzhaV3hzYVhCelpTQmplRDBpTlRNMExqTTNJaUJqZVQwaU1USXpMalV6SWlCeWVEMGlNVEl1TmpJM0lpQnllVDBpTWpZdU1qWTBJaTgrQ2p3dlp6NEtQQzluUGdvOEwzTjJaejRLXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGV4cGxhbmFyaWFuQXJyb3dTVkc7XG4iLCJcInVzZSBzdHJpY3RcIjtcblxuLypUaGlzIGNsYXNzIGlzIHN1cHBvc2VkIHRvIHR1cm4gYSBzZXJpZXMgb2ZcbmRpci5kZWxheSgpXG5kaXIudHJhbnNpdGlvblRvKC4uLilcbmRpci5kZWxheSgpXG5kaXIubmV4dFNsaWRlKCk7XG5cbmludG8gYSBzZXF1ZW5jZSB0aGF0IG9ubHkgYWR2YW5jZXMgd2hlbiB0aGUgcmlnaHQgYXJyb3cgaXMgcHJlc3NlZC5cblxuQW55IGRpdnMgd2l0aCB0aGUgZXhwLXNsaWRlIGNsYXNzIHdpbGwgYWxzbyBiZSBzaG93biBhbmQgaGlkZGVuIG9uZSBieSBvbmUuXG5cbkFsc28sXG5cbiovXG5cbmltcG9ydCB7QW5pbWF0aW9ufSBmcm9tICcuL0FuaW1hdGlvbi5qcyc7XG5pbXBvcnQgZXhwbGFuYXJpYW5BcnJvd1NWRyBmcm9tICcuL0RpcmVjdG9ySW1hZ2VDb25zdGFudHMuanMnO1xuXG5jbGFzcyBEaXJlY3Rpb25BcnJvd3tcbiAgICBjb25zdHJ1Y3RvcihmYWNlUmlnaHQpe1xuICAgICAgICB0aGlzLmFycm93SW1hZ2UgPSBuZXcgSW1hZ2UoKTtcbiAgICAgICAgdGhpcy5hcnJvd0ltYWdlLnNyYyA9IGV4cGxhbmFyaWFuQXJyb3dTVkc7XG5cbiAgICAgICAgdGhpcy5hcnJvd0ltYWdlLmNsYXNzTGlzdC5hZGQoXCJleHAtYXJyb3dcIik7XG5cbiAgICAgICAgZmFjZVJpZ2h0ID0gZmFjZVJpZ2h0PT09dW5kZWZpbmVkID8gdHJ1ZSA6IGZhY2VSaWdodDtcblxuICAgICAgICBpZihmYWNlUmlnaHQpe1xuICAgICAgICAgICAgdGhpcy5hcnJvd0ltYWdlLmNsYXNzTGlzdC5hZGQoXCJleHAtYXJyb3ctcmlnaHRcIilcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICB0aGlzLmFycm93SW1hZ2UuY2xhc3NMaXN0LmFkZChcImV4cC1hcnJvdy1sZWZ0XCIpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5hcnJvd0ltYWdlLm9uY2xpY2sgPSAoZnVuY3Rpb24oKXtcbiAgICAgICAgICAgIHRoaXMuaGlkZVNlbGYoKTtcbiAgICAgICAgICAgIHRoaXMub25jbGlja0NhbGxiYWNrKCk7XG4gICAgICAgIH0pLmJpbmQodGhpcyk7XG5cbiAgICAgICAgdGhpcy5vbmNsaWNrQ2FsbGJhY2sgPSBudWxsOyAvLyB0byBiZSBzZXQgZXh0ZXJuYWxseVxuICAgIH1cbiAgICBzaG93U2VsZigpe1xuICAgICAgICB0aGlzLmFycm93SW1hZ2Uuc3R5bGUucG9pbnRlckV2ZW50cyA9ICcnO1xuICAgICAgICB0aGlzLmFycm93SW1hZ2Uuc3R5bGUub3BhY2l0eSA9IDE7XG4gICAgICAgIFxuICAgIH1cbiAgICBoaWRlU2VsZigpe1xuICAgICAgICB0aGlzLmFycm93SW1hZ2Uuc3R5bGUub3BhY2l0eSA9IDA7XG4gICAgICAgIHRoaXMuYXJyb3dJbWFnZS5zdHlsZS5wb2ludGVyRXZlbnRzID0gJ25vbmUnO1xuICAgIH1cbn1cblxuXG5jbGFzcyBOb25EZWNyZWFzaW5nRGlyZWN0b3J7XG4gICAgLy9Vc2luZyBhIE5vbkRlY3JlYXNpbmdEaXJlY3RvciwgY3JlYXRlIEhUTUwgZWxlbWVudHMgd2l0aCB0aGUgJ2V4cC1zbGlkZScgY2xhc3MuXG4gICAgLy9UaGUgZmlyc3QgSFRNTCBlbGVtZW50IHdpdGggdGhlICdleHAtc2xpZGUnIGNsYXNzIHdpbGwgYmUgc2hvd24gZmlyc3QuIFdoZW4gdGhlIG5leHQgc2xpZGUgYnV0dG9uIGlzIGNsaWNrZWQsIHRoYXQgd2lsbCBmYWRlIG91dCBhbmQgYmUgcmVwbGFjZWQgd2l0aCB0aGUgbmV4dCBlbGVtZW50IHdpdGggdGhlIGV4cC1zbGlkZSBjbGFzcywgaW4gb3JkZXIgb2YgSFRNTC5cbiAgICAvL0lmIHlvdSB3YW50IHRvIGRpc3BsYXkgbXVsdGlwbGUgSFRNTCBlbGVtZW50cyBhdCB0aGUgc2FtZSB0aW1lLCAnZXhwLXNsaWRlLTxuPicgd2lsbCBhbHNvIGJlIGRpc3BsYXllZCB3aGVuIHRoZSBwcmVzZW50YXRpb24gaXMgY3VycmVudGx5IG9uIHNsaWRlIG51bWJlciBuLiBGb3IgZXhhbXBsZSwgZXZlcnl0aGluZyBpbiB0aGUgZXhwLXNsaWRlLTEgY2xhc3Mgd2lsbCBiZSB2aXNpYmxlIGZyb20gdGhlIHN0YXJ0LCBhbmQgdGhlbiBleHAtc2xpZGUtMiwgYW5kIHNvIG9uLlxuICAgIC8vRG9uJ3QgZ2l2ZSBhbiBlbGVtZW50IGJvdGggdGhlIGV4cC1zbGlkZSBhbmQgZXhwLXNsaWRlLW4gY2xhc3Nlcy4gXG5cbiAgICAvLyBJIHdhbnQgRGlyZWN0b3IoKSB0byBiZSBhYmxlIHRvIGJhY2t0cmFjayBieSBwcmVzc2luZyBiYWNrd2FyZHMuIFRoaXMgZG9lc24ndCBkbyB0aGF0LlxuICAgIGNvbnN0cnVjdG9yKG9wdGlvbnMpe1xuICAgICAgICB0aGlzLnNsaWRlcyA9IFtdO1xuICAgICAgICB0aGlzLmN1cnJlbnRTbGlkZUluZGV4ID0gMDsgICAgICAgIFxuICAgICAgICB0aGlzLm51bVNsaWRlcyA9IDA7XG4gICAgICAgIHRoaXMubnVtSFRNTFNsaWRlcyA9IDA7XG5cbiAgICAgICAgdGhpcy5uZXh0U2xpZGVSZXNvbHZlRnVuY3Rpb24gPSBudWxsO1xuICAgICAgICB0aGlzLmluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgfVxuXG4gICAgXG5cblxuICAgIGFzeW5jIGJlZ2luKCl7XG4gICAgICAgIGF3YWl0IHRoaXMud2FpdEZvclBhZ2VMb2FkKCk7XG5cbiAgICAgICAgdGhpcy5zZXR1cEFuZEhpZGVBbGxTbGlkZUhUTUxFbGVtZW50cygpO1xuXG4gICAgICAgIHRoaXMuc3dpdGNoRGlzcGxheWVkU2xpZGVJbmRleCgwKTsgLy91bmhpZGUgZmlyc3Qgb25lXG5cbiAgICAgICAgdGhpcy5zZXR1cENsaWNrYWJsZXMoKTtcblxuICAgICAgICB0aGlzLmluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBzZXR1cEFuZEhpZGVBbGxTbGlkZUhUTUxFbGVtZW50cygpe1xuXG4gICAgICAgIHRoaXMuc2xpZGVzID0gZG9jdW1lbnQuZ2V0RWxlbWVudHNCeUNsYXNzTmFtZShcImV4cC1zbGlkZVwiKTtcbiAgICAgICAgdGhpcy5udW1IVE1MU2xpZGVzID0gdGhpcy5zbGlkZXMubGVuZ3RoO1xuXG4gICAgICAgIC8vaGlkZSBhbGwgc2xpZGVzIGV4Y2VwdCBmaXJzdCBvbmVcbiAgICAgICAgZm9yKHZhciBpPTA7aTx0aGlzLm51bUhUTUxTbGlkZXM7aSsrKXtcbiAgICAgICAgICAgIHRoaXMuc2xpZGVzW2ldLnN0eWxlLm9wYWNpdHkgPSAwOyBcbiAgICAgICAgICAgIHRoaXMuc2xpZGVzW2ldLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7Ly9vcGFjaXR5PTAgYWxvbmUgd29uJ3QgYmUgaW5zdGFudCBiZWNhdXNlIG9mIHRoZSAxcyBDU1MgdHJhbnNpdGlvblxuICAgICAgICB9XG4gICAgICAgIGxldCBzZWxmID0gdGhpcztcbiAgICAgICAgLy91bmRvIHNldHRpbmcgZGlzcGxheS1ub25lIGFmdGVyIGEgYml0IG9mIHRpbWVcbiAgICAgICAgd2luZG93LnNldFRpbWVvdXQoZnVuY3Rpb24oKXtcbiAgICAgICAgICAgIGZvcih2YXIgaT0wO2k8c2VsZi5zbGlkZXMubGVuZ3RoO2krKyl7XG4gICAgICAgICAgICAgICAgc2VsZi5zbGlkZXNbaV0uc3R5bGUuZGlzcGxheSA9ICcnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LDEpO1xuXG4gICAgICAgIC8vbm93IGhhbmRsZSBleHAtc2xpZGUtPG4+XG4gICAgICAgIGxldCBhbGxTcGVjaWZpY1NsaWRlRWxlbWVudHMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdbY2xhc3MqPVwiZXhwLXNsaWRlLVwiXScpOyAvL3RoaXMgaXMgYSBDU1MgYXR0cmlidXRlIHNlbGVjdG9yLCBhbmQgSSBoYXRlIHRoYXQgdGhpcyBleGlzdHMuIGl0J3Mgc28gdWdseVxuICAgICAgICBmb3IodmFyIGk9MDtpPGFsbFNwZWNpZmljU2xpZGVFbGVtZW50cy5sZW5ndGg7aSsrKXtcbiAgICAgICAgICAgIGFsbFNwZWNpZmljU2xpZGVFbGVtZW50c1tpXS5zdHlsZS5vcGFjaXR5ID0gMDsgXG4gICAgICAgICAgICBhbGxTcGVjaWZpY1NsaWRlRWxlbWVudHNbaV0uc3R5bGUuZGlzcGxheSA9ICdub25lJzsvL29wYWNpdHk9MCBhbG9uZSB3b24ndCBiZSBpbnN0YW50IGJlY2F1c2Ugb2YgdGhlIDFzIENTUyB0cmFuc2l0aW9uXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzZXR1cENsaWNrYWJsZXMoKXtcbiAgICAgICAgbGV0IHNlbGYgPSB0aGlzO1xuXG4gICAgICAgIHRoaXMucmlnaHRBcnJvdyA9IG5ldyBEaXJlY3Rpb25BcnJvdygpO1xuICAgICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKHRoaXMucmlnaHRBcnJvdy5hcnJvd0ltYWdlKTtcbiAgICAgICAgdGhpcy5yaWdodEFycm93Lm9uY2xpY2tDYWxsYmFjayA9IGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICBzZWxmLl9jaGFuZ2VTbGlkZSgxLCBmdW5jdGlvbigpe30pOyAvLyB0aGlzIGVycm9ycyB3aXRob3V0IHRoZSBlbXB0eSBmdW5jdGlvbiBiZWNhdXNlIHRoZXJlJ3Mgbm8gcmVzb2x2ZS4gVGhlcmUgbXVzdCBiZSBhIGJldHRlciB3YXkgdG8gZG8gdGhpbmdzLlxuICAgICAgICAgICAgY29uc29sZS53YXJuKFwiV0FSTklORzogSG9ycmlibGUgaGFjayBpbiBlZmZlY3QgdG8gY2hhbmdlIHNsaWRlcy4gUGxlYXNlIHJlcGxhY2UgdGhlIHBhc3MtYW4tZW1wdHktZnVuY3Rpb24gdGhpbmcgd2l0aCBzb21ldGhpbmcgdGhhdCBhY3R1YWxseSByZXNvbHZlcyBwcm9wZXJseSBhbmQgZG9lcyBhc3luYy5cIilcbiAgICAgICAgICAgIHNlbGYubmV4dFNsaWRlUmVzb2x2ZUZ1bmN0aW9uKCk7XG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIGFzeW5jIHdhaXRGb3JQYWdlTG9hZCgpe1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KXtcbiAgICAgICAgICAgIGlmKGRvY3VtZW50LnJlYWR5U3RhdGUgPT0gJ2NvbXBsZXRlJyl7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJET01Db250ZW50TG9hZGVkXCIscmVzb2x2ZSk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBhc3luYyBuZXh0U2xpZGUoKXtcbiAgICAgICAgaWYoIXRoaXMuaW5pdGlhbGl6ZWQpdGhyb3cgbmV3IEVycm9yKFwiRVJST1I6IFVzZSAuYmVnaW4oKSBvbiBhIERpcmVjdG9yIGJlZm9yZSBjYWxsaW5nIGFueSBvdGhlciBtZXRob2RzIVwiKTtcblxuICAgICAgICBsZXQgc2VsZiA9IHRoaXM7XG5cbiAgICAgICAgdGhpcy5yaWdodEFycm93LnNob3dTZWxmKCk7XG4gICAgICAgIC8vcHJvbWlzZSBpcyByZXNvbHZlZCBieSBjYWxsaW5nIHRoaXMubmV4dFNsaWRlUHJvbWlzZS5yZXNvbHZlKCkgd2hlbiB0aGUgdGltZSBjb21lc1xuXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3Qpe1xuICAgICAgICAgICAgZnVuY3Rpb24ga2V5TGlzdGVuZXIoZSl7XG4gICAgICAgICAgICAgICAgaWYoZS5yZXBlYXQpcmV0dXJuOyAvL2tleWRvd24gZmlyZXMgbXVsdGlwbGUgdGltZXMgYnV0IHdlIG9ubHkgd2FudCB0aGUgZmlyc3Qgb25lXG4gICAgICAgICAgICAgICAgbGV0IHNsaWRlRGVsdGEgPSAwO1xuICAgICAgICAgICAgICAgIHN3aXRjaCAoZS5rZXlDb2RlKSB7XG4gICAgICAgICAgICAgICAgICBjYXNlIDM0OlxuICAgICAgICAgICAgICAgICAgY2FzZSAzOTpcbiAgICAgICAgICAgICAgICAgIGNhc2UgNDA6XG4gICAgICAgICAgICAgICAgICAgIHNsaWRlRGVsdGEgPSAxO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZihzbGlkZURlbHRhICE9IDApe1xuICAgICAgICAgICAgICAgICAgICBzZWxmLl9jaGFuZ2VTbGlkZShzbGlkZURlbHRhLCByZXNvbHZlKTtcbiAgICAgICAgICAgICAgICAgICAgc2VsZi5yaWdodEFycm93LmhpZGVTZWxmKCk7XG4gICAgICAgICAgICAgICAgICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLGtleUxpc3RlbmVyKTsgLy90aGlzIGFwcHJvYWNoIHRha2VuIGZyb20gaHR0cHM6Ly9zdGFja292ZXJmbG93LmNvbS9xdWVzdGlvbnMvMzU3MTg2NDUvcmVzb2x2aW5nLWEtcHJvbWlzZS13aXRoLWV2ZW50bGlzdGVuZXJcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBrZXlMaXN0ZW5lcik7XG4gICAgICAgICAgICAvL2hvcnJpYmxlIGhhY2sgc28gdGhhdCB0aGUgJ25leHQgc2xpZGUnIGFycm93IGNhbiB0cmlnZ2VyIHRoaXMgdG9vXG4gICAgICAgICAgICBzZWxmLm5leHRTbGlkZVJlc29sdmVGdW5jdGlvbiA9IGZ1bmN0aW9uKCl7IFxuICAgICAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIixrZXlMaXN0ZW5lcik7IFxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG4gICAgX2NoYW5nZVNsaWRlKHNsaWRlRGVsdGEsIHJlc29sdmUpe1xuICAgICAgICAvL3NsaWRlIGNoYW5naW5nIGxvZ2ljXG4gICAgICAgIGlmKHNsaWRlRGVsdGEgIT0gMCl7XG4gICAgICAgICAgICBpZih0aGlzLmN1cnJlbnRTbGlkZUluZGV4ID09IDAgJiYgc2xpZGVEZWx0YSA9PSAtMSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuOyAvL25vIGdvaW5nIHBhc3QgdGhlIGJlZ2lubmluZ1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYodGhpcy5jdXJyZW50U2xpZGVJbmRleCA9PSB0aGlzLm51bUhUTUxTbGlkZXMtMSAmJiBzbGlkZURlbHRhID09IDEpe1xuICAgICAgICAgICAgICAgIHJldHVybjsgLy9ubyBnb2luZyBwYXN0IHRoZSBlbmRcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5zd2l0Y2hEaXNwbGF5ZWRTbGlkZUluZGV4KHRoaXMuY3VycmVudFNsaWRlSW5kZXggKyBzbGlkZURlbHRhKTtcbiAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHN3aXRjaERpc3BsYXllZFNsaWRlSW5kZXgoc2xpZGVOdW1iZXIpe1xuICAgICAgICAvL3VwZGF0ZXMgSFRNTCBhbmQgYWxzbyBzZXRzIHRoaXMuY3VycmVudFNsaWRlSW5kZXggdG8gc2xpZGVOdW1iZXJcblxuICAgICAgICBsZXQgcHJldlNsaWRlTnVtYmVyID0gdGhpcy5jdXJyZW50U2xpZGVJbmRleDtcbiAgICAgICAgdGhpcy5jdXJyZW50U2xpZGVJbmRleCA9IHNsaWRlTnVtYmVyO1xuXG5cbiAgICAgICAgLy9oaWRlIHRoZSBIVE1MIGVsZW1lbnRzIGZvciB0aGUgcHJldmlvdXMgc2xpZGVcblxuICAgICAgICAvL2l0ZW1zIHdpdGggY2xhc3MgZXhwLXNsaWRlXG4gICAgICAgIGlmKHByZXZTbGlkZU51bWJlciA8IHRoaXMuc2xpZGVzLmxlbmd0aCl7XG4gICAgICAgICAgICB0aGlzLnNsaWRlc1twcmV2U2xpZGVOdW1iZXJdLnN0eWxlLm9wYWNpdHkgPSAwO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvL2l0ZW1zIHdpdGggSFRNTCBjbGFzcyBleHAtc2xpZGUtblxuICAgICAgICBsZXQgcHJldlNsaWRlRWxlbXMgPSBkb2N1bWVudC5nZXRFbGVtZW50c0J5Q2xhc3NOYW1lKFwiZXhwLXNsaWRlLVwiKyhwcmV2U2xpZGVOdW1iZXIrMSkpXG4gICAgICAgIGZvcih2YXIgaT0wO2k8cHJldlNsaWRlRWxlbXMubGVuZ3RoO2krKyl7XG4gICAgICAgICAgICBwcmV2U2xpZGVFbGVtc1tpXS5zdHlsZS5vcGFjaXR5ID0gMDtcbiAgICAgICAgfVxuXG5cbiAgICAgICAgLy9zaG93IHRoZSBIVE1MIGVsZW1lbnRzIGZvciB0aGUgY3VycmVudCBzbGlkZVxuICBcbiAgICAgICAgXG4gICAgICAgIC8vaXRlbXMgd2l0aCBIVE1MIGNsYXNzIGV4cC1zbGlkZS1uXG4gICAgICAgIGxldCBlbGVtc1RvRGlzcGxheU9ubHlPblRoaXNTbGlkZSA9IGRvY3VtZW50LmdldEVsZW1lbnRzQnlDbGFzc05hbWUoXCJleHAtc2xpZGUtXCIrKHNsaWRlTnVtYmVyKzEpKTtcblxuICAgICAgICBpZihzbGlkZU51bWJlciA+PSB0aGlzLm51bUhUTUxTbGlkZXMgJiYgZWxlbXNUb0Rpc3BsYXlPbmx5T25UaGlzU2xpZGUubGVuZ3RoID09IDApe1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIlRyaWVkIHRvIHNob3cgc2xpZGUgI1wiK3NsaWRlTnVtYmVyK1wiLCBidXQgb25seSBcIiArIHRoaXMubnVtSFRNTFNsaWRlcyArIFwiSFRNTCBlbGVtZW50cyB3aXRoIGV4cC1zbGlkZSB3ZXJlIGZvdW5kISBNYWtlIG1vcmUgc2xpZGVzP1wiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvcih2YXIgaT0wO2k8ZWxlbXNUb0Rpc3BsYXlPbmx5T25UaGlzU2xpZGUubGVuZ3RoO2krKyl7XG4gICAgICAgICAgICBlbGVtc1RvRGlzcGxheU9ubHlPblRoaXNTbGlkZVtpXS5zdHlsZS5vcGFjaXR5ID0gMTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vaXRlbXMgd2l0aCBjbGFzcyBleHAtc2xpZGVcbiAgICAgICAgaWYoc2xpZGVOdW1iZXIgPCB0aGlzLnNsaWRlcy5sZW5ndGgpe1xuICAgICAgICAgICAgdGhpcy5zbGlkZXNbc2xpZGVOdW1iZXJdLnN0eWxlLm9wYWNpdHkgPSAxO1xuICAgICAgICB9XG5cbiAgICB9XG5cbiAgICAvL3ZlcmJzXG4gICAgYXN5bmMgZGVsYXkod2FpdFRpbWUpe1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KXtcbiAgICAgICAgICAgIHdpbmRvdy5zZXRUaW1lb3V0KHJlc29sdmUsIHdhaXRUaW1lKTtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIFRyYW5zaXRpb25Ubyh0YXJnZXQsIHRvVmFsdWVzLCBkdXJhdGlvbk1TKXtcbiAgICAgICAgLy9VdGlscy5Bc3NlcnQodGhpcy51bmRvU3RhY2tJbmRleCA9PSAwKTsgLy9UaGlzIG1heSBub3Qgd29yayB3ZWxsLlxuICAgICAgICBuZXcgQW5pbWF0aW9uKHRhcmdldCwgdG9WYWx1ZXMsIGR1cmF0aW9uTVMgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IGR1cmF0aW9uTVMvMTAwMCk7XG4gICAgfVxufVxuXG5cblxuXG5cblxuXG5jbGFzcyBVbmRvQ2FwYWJsZURpcmVjdG9yIGV4dGVuZHMgTm9uRGVjcmVhc2luZ0RpcmVjdG9ye1xuICAgIC8vdGhzaSBkaXJlY3RvciB1c2VzIGJvdGggZm9yd2FyZHMgYW5kIGJhY2t3YXJkcyBhcnJvd3MuIHRoZSBiYWNrd2FyZHMgYXJyb3cgd2lsbCB1bmRvIGFueSBVbmRvQ2FwYWJsZURpcmVjdG9yLlRyYW5zaXRpb25Ubygpc1xuICAgIC8vdG9kbzogaG9vayB1cCB0aGUgYXJyb3dzIGFuZCBtYWtlIGl0IG5vdFxuICAgIGNvbnN0cnVjdG9yKG9wdGlvbnMpe1xuICAgICAgICBzdXBlcihvcHRpb25zKTtcblxuICAgICAgICB0aGlzLmZ1cnRoZXN0U2xpZGVJbmRleCA9IDA7IC8vbWF0Y2hlcyB0aGUgbnVtYmVyIG9mIHRpbWVzIG5leHRTbGlkZSgpIGhhcyBiZWVuIGNhbGxlZFxuICAgICAgICAvL3RoaXMuY3VycmVudFNsaWRlSW5kZXggaXMgYWx3YXlzIDwgdGhpcy5mdXJ0aGVzdFNsaWRlSW5kZXggLSBpZiBlcXVhbCwgd2UgcmVsZWFzZSB0aGUgcHJvbWlzZSBhbmQgbGV0IG5leHRTbGlkZSgpIHJldHVyblxuXG4gICAgICAgIHRoaXMudW5kb1N0YWNrID0gW107XG4gICAgICAgIHRoaXMudW5kb1N0YWNrSW5kZXggPSAwOyAvL2luY3JlYXNlZCBieSBvbmUgZXZlcnkgdGltZSBlaXRoZXIgdGhpcy5UcmFuc2l0aW9uVG8gaXMgY2FsbGVkIG9yIHRoaXMubmV4dFNsaWRlKCkgaXMgY2FsbGVkXG5cbiAgICAgICAgbGV0IHNlbGYgPSB0aGlzO1xuXG4gICAgICAgIC8vaWYgeW91IHByZXNzIHJpZ2h0IGJlZm9yZSB0aGUgZmlyc3QgZGlyZWN0b3IubmV4dFNsaWRlKCksIGRvbid0IGVycm9yXG4gICAgICAgIHRoaXMubmV4dFNsaWRlUmVzb2x2ZUZ1bmN0aW9uID0gZnVuY3Rpb24oKXt9IFxuXG4gICAgICAgIGZ1bmN0aW9uIGtleUxpc3RlbmVyKGUpe1xuICAgICAgICAgICAgaWYoZS5yZXBlYXQpcmV0dXJuOyAvL2tleWRvd24gZmlyZXMgbXVsdGlwbGUgdGltZXMgYnV0IHdlIG9ubHkgd2FudCB0aGUgZmlyc3Qgb25lXG4gICAgICAgICAgICBsZXQgc2xpZGVEZWx0YSA9IDA7XG4gICAgICAgICAgICBzd2l0Y2ggKGUua2V5Q29kZSkge1xuICAgICAgICAgICAgICBjYXNlIDM0OlxuICAgICAgICAgICAgICBjYXNlIDM5OlxuICAgICAgICAgICAgICBjYXNlIDQwOlxuICAgICAgICAgICAgICAgIHNlbGYuaGFuZGxlRm9yd2FyZHNQcmVzcygpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICBjYXNlIDMzOlxuICAgICAgICAgICAgICBjYXNlIDM3OlxuICAgICAgICAgICAgICBjYXNlIDM4OlxuICAgICAgICAgICAgICAgIHNlbGYuaGFuZGxlQmFja3dhcmRzUHJlc3MoKTtcbiAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBrZXlMaXN0ZW5lcik7XG4gICAgfVxuXG4gICAgc2V0dXBDbGlja2FibGVzKCl7XG4gICAgICAgIGxldCBzZWxmID0gdGhpcztcblxuICAgICAgICB0aGlzLmxlZnRBcnJvdyA9IG5ldyBEaXJlY3Rpb25BcnJvdyhmYWxzZSk7XG4gICAgICAgIHRoaXMubGVmdEFycm93LmhpZGVTZWxmKCk7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQodGhpcy5sZWZ0QXJyb3cuYXJyb3dJbWFnZSk7XG4gICAgICAgIHRoaXMubGVmdEFycm93Lm9uY2xpY2tDYWxsYmFjayA9IGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICBzZWxmLmhhbmRsZUJhY2t3YXJkc1ByZXNzKCk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnJpZ2h0QXJyb3cgPSBuZXcgRGlyZWN0aW9uQXJyb3codHJ1ZSk7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQodGhpcy5yaWdodEFycm93LmFycm93SW1hZ2UpO1xuICAgICAgICB0aGlzLnJpZ2h0QXJyb3cub25jbGlja0NhbGxiYWNrID0gZnVuY3Rpb24oKXtcbiAgICAgICAgICAgIHNlbGYuaGFuZGxlRm9yd2FyZHNQcmVzcygpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgbW92ZUZ1cnRoZXJJbnRvUHJlc2VudGF0aW9uKCl7XG4gICAgICAgICAgICAvL2lmIHRoZXJlJ3Mgbm90aGluZyB0byByZWRvLCAoc28gd2UncmUgbm90IGluIHRoZSBwYXN0IG9mIHRoZSB1bmRvIHN0YWNrKSwgYWR2YW5jZSBmdXJ0aGVyLlxuICAgICAgICAgICAgLy9pZiB0aGVyZSBhcmUgbGVzcyBIVE1MIHNsaWRlcyB0aGFuIGNhbGxzIHRvIGRpcmVjdG9yLm5ld1NsaWRlKCksIGNvbXBsYWluIGluIHRoZSBjb25zb2xlIGJ1dCBhbGxvdyB0aGUgcHJlc2VudGF0aW9uIHRvIHByb2NlZWRcbiAgICAgICAgICAgIGlmKHRoaXMuY3VycmVudFNsaWRlSW5kZXggPCB0aGlzLm51bVNsaWRlcyl7XG4gICAgICAgICAgICAgICAgdGhpcy51bmRvU3RhY2tJbmRleCArPSAxOyAvL2FkdmFuY2UgcGFzdCB0aGUgTmV3U2xpZGVVbmRvSXRlbVxuICAgICAgICAgICAgICAgIHRoaXMuZnVydGhlc3RTbGlkZUluZGV4ICs9IDE7IFxuXG4gICAgICAgICAgICAgICAgdGhpcy5zd2l0Y2hEaXNwbGF5ZWRTbGlkZUluZGV4KHRoaXMuY3VycmVudFNsaWRlSW5kZXggKyAxKTsgLy90aGlzIHdpbGwgY29tcGxhaW4gaW4gdGhlIGNvbnNvbGUgd2luZG93IGlmIHRoZXJlIGFyZSBsZXNzIHNsaWRlcyB0aGFuIG5ld1NsaWRlKCkgY2FsbHNcbiAgICAgICAgICAgICAgICB0aGlzLnNob3dBcnJvd3MoKTsgLy9zaG93QXJyb3dzIG11c3QgY29tZSBhZnRlciB0aGlzLmN1cnJlbnRTbGlkZUluZGV4IGFkdmFuY2VzIG9yIGVsc2Ugd2Ugd29uJ3QgYmUgYWJsZSB0byB0ZWxsIGlmIHdlJ3JlIGF0IHRoZSBlbmQgb3Igbm90XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLm5leHRTbGlkZVJlc29sdmVGdW5jdGlvbigpOyAvL2FsbG93IHByZXNlbnRhdGlvbiBjb2RlIHRvIHByb2NlZWRcbiAgICB9XG5cbiAgICBoYW5kbGVGb3J3YXJkc1ByZXNzKCl7XG4gICAgICAgIHRoaXMucmlnaHRBcnJvdy5oaWRlU2VsZigpO1xuXG4gICAgICAgIGlmKHRoaXMuZnVydGhlc3RTbGlkZUluZGV4ID09IHRoaXMuY3VycmVudFNsaWRlSW5kZXgpe1xuICAgICAgICAgICAgLy9pZiBub3RoaW5nIHRvIHJlZG9cbiAgICAgICAgICAgIHRoaXMubW92ZUZ1cnRoZXJJbnRvUHJlc2VudGF0aW9uKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgLy8gaWYgd2UgZ2V0IHRvIGhlcmUsIHdlJ3ZlIHByZXZpb3VzbHkgZG9uZSBhbiB1bmRvIGFuZCB3ZSBuZWVkIHRvIGNhdGNoIHVwXG5cbiAgICAgICAgaWYodGhpcy51bmRvU3RhY2tJbmRleCA8IHRoaXMudW5kb1N0YWNrLmxlbmd0aC0xKSB0aGlzLnVuZG9TdGFja0luZGV4ICs9IDE7XG5cbiAgICAgICAgd2hpbGUodGhpcy51bmRvU3RhY2tbdGhpcy51bmRvU3RhY2tJbmRleF0uY29uc3RydWN0b3IgIT09IE5ld1NsaWRlVW5kb0l0ZW0pe1xuICAgICAgICAgICAgLy9sb29wIHRocm91Z2ggdW5kbyBzdGFjayBhbmQgcmVkbyBlYWNoIHVuZG9cblxuICAgICAgICAgICAgbGV0IHJlZG9JdGVtID0gdGhpcy51bmRvU3RhY2tbdGhpcy51bmRvU3RhY2tJbmRleF1cbiAgICAgICAgICAgIHN3aXRjaChyZWRvSXRlbS50eXBlKXtcbiAgICAgICAgICAgICAgICBjYXNlIERFTEFZOlxuICAgICAgICAgICAgICAgICAgICAvL3doaWxlIHJlZG9pbmcsIHNraXAgYW55IGRlbGF5c1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlIFRSQU5TSVRJT05UTzpcbiAgICAgICAgICAgICAgICAgICAgdmFyIHJlZG9BbmltYXRpb24gPSBuZXcgQW5pbWF0aW9uKHJlZG9JdGVtLnRhcmdldCwgcmVkb0l0ZW0udG9WYWx1ZXMsIHJlZG9JdGVtLmR1cmF0aW9uTVMgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IHJlZG9JdGVtLmR1cmF0aW9uTVMvMTAwMCk7XG4gICAgICAgICAgICAgICAgICAvL2FuZCBub3cgcmVkb0FuaW1hdGlvbiwgaGF2aW5nIGJlZW4gY3JlYXRlZCwgZ29lcyBvZmYgYW5kIGRvZXMgaXRzIG93biB0aGluZyBJIGd1ZXNzLiB0aGlzIHNlZW1zIGluZWZmaWNpZW50LiB0b2RvOiBmaXggdGhhdCBhbmQgbWFrZSB0aGVtIGFsbCBjZW50cmFsbHkgdXBkYXRlZCBieSB0aGUgYW5pbWF0aW9uIGxvb3Agb3Jzb21ldGhpbmdcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSBORVdTTElERTpcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKHRoaXMudW5kb1N0YWNrSW5kZXggPT0gdGhpcy51bmRvU3RhY2subGVuZ3RoLTEpe1xuICAgICAgICAgICAgICAgIC8vZnVsbHkgcmVkb25lIGFuZCBhdCBjdXJyZW50IHNsaWRlXG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMudW5kb1N0YWNrSW5kZXggKz0gMTtcblxuICAgICAgICB9XG4gICAgICAgIHRoaXMuc3dpdGNoRGlzcGxheWVkU2xpZGVJbmRleCh0aGlzLmN1cnJlbnRTbGlkZUluZGV4ICsgMSk7XG4gICAgICAgIHRoaXMuc2hvd0Fycm93cygpO1xuICAgIH1cblxuICAgIGhhbmRsZUJhY2t3YXJkc1ByZXNzKCl7XG4gICAgICAgIHRoaXMubGVmdEFycm93LmhpZGVTZWxmKCk7XG5cbiAgICAgICAgaWYodGhpcy51bmRvU3RhY2tJbmRleCA9PSAwIHx8IHRoaXMuY3VycmVudFNsaWRlSW5kZXggPT0gMCl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnVuZG9TdGFja0luZGV4IC09IDE7XG4gICAgICAgIHdoaWxlKHRoaXMudW5kb1N0YWNrW3RoaXMudW5kb1N0YWNrSW5kZXhdLmNvbnN0cnVjdG9yICE9PSBOZXdTbGlkZVVuZG9JdGVtKXtcbiAgICAgICAgICAgIC8vbG9vcCB0aHJvdWdoIHVuZG8gc3RhY2sgYW5kIHJlZG8gZWFjaCB1bmRvXG5cbiAgICAgICAgICAgIGlmKHRoaXMudW5kb1N0YWNrSW5kZXggPT0gMCl7XG4gICAgICAgICAgICAgICAgLy9hdCBmaXJzdCBzbGlkZVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvL3VuZG8gdHJhbnNmb3JtYXRpb24gaW4gdGhpcy51bmRvU3RhY2tbdGhpcy51bmRvU3RhY2tJbmRleF1cbiAgICAgICAgICAgIGxldCB1bmRvSXRlbSA9IHRoaXMudW5kb1N0YWNrW3RoaXMudW5kb1N0YWNrSW5kZXhdO1xuICAgICAgICAgICAgc3dpdGNoKHVuZG9JdGVtLnR5cGUpe1xuICAgICAgICAgICAgICAgIGNhc2UgREVMQVk6XG4gICAgICAgICAgICAgICAgICAgIC8vd2hpbGUgdW5kb2luZywgc2tpcCBhbnkgZGVsYXlzXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgVFJBTlNJVElPTlRPOlxuICAgICAgICAgICAgICAgICAgICBsZXQgZHVyYXRpb24gPSB1bmRvSXRlbS5kdXJhdGlvbk1TID09PSB1bmRlZmluZWQgPyAxIDogdW5kb0l0ZW0uZHVyYXRpb25NUy8xMDAwO1xuICAgICAgICAgICAgICAgICAgICBkdXJhdGlvbiA9IE1hdGgubWluKGR1cmF0aW9uIC8gMiwgMSk7IC8vdW5kb2luZyBzaG91bGQgYmUgZmFzdGVyLCBzbyBjdXQgaXQgaW4gaGFsZiAtIGJ1dCBjYXAgZHVyYXRpb25zIGF0IDFzXG4gICAgICAgICAgICAgICAgICAgIHZhciB1bmRvQW5pbWF0aW9uID0gbmV3IEFuaW1hdGlvbih1bmRvSXRlbS50YXJnZXQsIHVuZG9JdGVtLmZyb21WYWx1ZXMsIGR1cmF0aW9uKTtcbiAgICAgICAgICAgICAgICAgICAgLy9hbmQgbm93IHVuZG9BbmltYXRpb24sIGhhdmluZyBiZWVuIGNyZWF0ZWQsIGdvZXMgb2ZmIGFuZCBkb2VzIGl0cyBvd24gdGhpbmcgSSBndWVzcy4gdGhpcyBzZWVtcyBpbmVmZmljaWVudC4gdG9kbzogZml4IHRoYXQgYW5kIG1ha2UgdGhlbSBhbGwgY2VudHJhbGx5IHVwZGF0ZWQgYnkgdGhlIGFuaW1hdGlvbiBsb29wIG9yc29tZXRoaW5nXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgTkVXU0xJREU6XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy51bmRvU3RhY2tJbmRleCAtPSAxO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuc3dpdGNoRGlzcGxheWVkU2xpZGVJbmRleCh0aGlzLmN1cnJlbnRTbGlkZUluZGV4IC0gMSk7XG4gICAgICAgIHRoaXMuc2hvd0Fycm93cygpO1xuICAgIH1cblxuICAgIHNob3dBcnJvd3MoKXtcbiAgICAgICAgaWYodGhpcy5jdXJyZW50U2xpZGVJbmRleCA+IDApe1xuICAgICAgICAgICAgdGhpcy5sZWZ0QXJyb3cuc2hvd1NlbGYoKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICB0aGlzLmxlZnRBcnJvdy5oaWRlU2VsZigpO1xuICAgICAgICB9XG4gICAgICAgIGlmKHRoaXMuY3VycmVudFNsaWRlSW5kZXggPCB0aGlzLm51bVNsaWRlcyl7XG4gICAgICAgICAgICB0aGlzLnJpZ2h0QXJyb3cuc2hvd1NlbGYoKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICB0aGlzLnJpZ2h0QXJyb3cuaGlkZVNlbGYoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFzeW5jIG5leHRTbGlkZSgpe1xuICAgICAgICAvKlRoZSB1c2VyIHdpbGwgY2FsbCB0aGlzIGZ1bmN0aW9uIHRvIG1hcmsgdGhlIHRyYW5zaXRpb24gYmV0d2VlbiBvbmUgc2xpZGUgYW5kIHRoZSBuZXh0LiBUaGlzIGRvZXMgdHdvIHRoaW5nczpcbiAgICAgICAgQSkgd2FpdHMgdW50aWwgdGhlIHVzZXIgcHJlc3NlcyB0aGUgcmlnaHQgYXJyb3cga2V5LCByZXR1cm5zLCBhbmQgY29udGludWVzIGV4ZWN1dGlvbiB1bnRpbCB0aGUgbmV4dCBuZXh0U2xpZGUoKSBjYWxsXG4gICAgICAgIEIpIGlmIHRoZSB1c2VyIHByZXNzZXMgdGhlIGxlZnQgYXJyb3cga2V5LCB0aGV5IGNhbiB1bmRvIGFuZCBnbyBiYWNrIGluIHRpbWUsIGFuZCBldmVyeSBUcmFuc2l0aW9uVG8oKSBjYWxsIGJlZm9yZSB0aGF0IHdpbGwgYmUgdW5kb25lIHVudGlsIGl0IHJlYWNoZXMgYSBwcmV2aW91cyBuZXh0U2xpZGUoKSBjYWxsLiBBbnkgbm9ybWFsIGphdmFzY3JpcHQgYXNzaWdubWVudHMgd29uJ3QgYmUgY2F1Z2h0IGluIHRoaXMgOihcbiAgICAgICAgQykgaWYgdW5kb1xuICAgICAgICAqL1xuICAgICAgICBpZighdGhpcy5pbml0aWFsaXplZCl0aHJvdyBuZXcgRXJyb3IoXCJFUlJPUjogVXNlIC5iZWdpbigpIG9uIGEgRGlyZWN0b3IgYmVmb3JlIGNhbGxpbmcgYW55IG90aGVyIG1ldGhvZHMhXCIpO1xuXG4gICAgICAgIFxuICAgICAgICB0aGlzLm51bVNsaWRlcysrO1xuICAgICAgICB0aGlzLnVuZG9TdGFjay5wdXNoKG5ldyBOZXdTbGlkZVVuZG9JdGVtKHRoaXMuY3VycmVudFNsaWRlSW5kZXgpKTtcbiAgICAgICAgdGhpcy5zaG93QXJyb3dzKCk7XG5cblxuICAgICAgICBsZXQgc2VsZiA9IHRoaXM7XG5cbiAgICAgICAgLy9wcm9taXNlIGlzIHJlc29sdmVkIGJ5IGNhbGxpbmcgdGhpcy5uZXh0U2xpZGVSZXNvbHZlRnVuY3Rpb24oKSB3aGVuIHRoZSB0aW1lIGNvbWVzXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3Qpe1xuICAgICAgICAgICAgc2VsZi5uZXh0U2xpZGVSZXNvbHZlRnVuY3Rpb24gPSBmdW5jdGlvbigpeyBcbiAgICAgICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgfVxuXG4gICAgYXN5bmMgZGVsYXkod2FpdFRpbWUpe1xuICAgICAgICB0aGlzLnVuZG9TdGFjay5wdXNoKG5ldyBEZWxheVVuZG9JdGVtKHdhaXRUaW1lKSk7XG4gICAgICAgIHRoaXMudW5kb1N0YWNrSW5kZXgrKztcbiAgICAgICAgYXdhaXQgc3VwZXIuZGVsYXkod2FpdFRpbWUpO1xuICAgIH1cbiAgICBUcmFuc2l0aW9uVG8odGFyZ2V0LCB0b1ZhbHVlcywgZHVyYXRpb25NUyl7XG4gICAgICAgIHZhciBhbmltYXRpb24gPSBuZXcgQW5pbWF0aW9uKHRhcmdldCwgdG9WYWx1ZXMsIGR1cmF0aW9uTVMgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IGR1cmF0aW9uTVMvMTAwMCk7XG4gICAgICAgIGxldCBmcm9tVmFsdWVzID0gYW5pbWF0aW9uLmZyb21WYWx1ZXM7XG4gICAgICAgIHRoaXMudW5kb1N0YWNrLnB1c2gobmV3IFVuZG9JdGVtKHRhcmdldCwgdG9WYWx1ZXMsIGZyb21WYWx1ZXMsIGR1cmF0aW9uTVMpKTtcbiAgICAgICAgdGhpcy51bmRvU3RhY2tJbmRleCsrO1xuICAgIH1cbn1cblxuXG4vL2Rpc2NvdW50IGVudW1cbmNvbnN0IFRSQU5TSVRJT05UTyA9IDA7XG5jb25zdCBORVdTTElERSA9IDE7XG5jb25zdCBERUxBWT0yO1xuXG4vL3RoaW5ncyB0aGF0IGNhbiBiZSBzdG9yZWQgaW4gYSBVbmRvQ2FwYWJsZURpcmVjdG9yJ3MgLnVuZG9TdGFja1tdXG5jbGFzcyBVbmRvSXRlbXtcbiAgICBjb25zdHJ1Y3Rvcih0YXJnZXQsIHRvVmFsdWVzLCBmcm9tVmFsdWVzLCBkdXJhdGlvbk1TKXtcbiAgICAgICAgdGhpcy50YXJnZXQgPSB0YXJnZXQ7XG4gICAgICAgIHRoaXMudG9WYWx1ZXMgPSB0b1ZhbHVlcztcbiAgICAgICAgdGhpcy5mcm9tVmFsdWVzID0gZnJvbVZhbHVlcztcbiAgICAgICAgdGhpcy5kdXJhdGlvbk1TID0gZHVyYXRpb25NUztcbiAgICAgICAgdGhpcy50eXBlID0gVFJBTlNJVElPTlRPO1xuICAgIH1cbn1cblxuY2xhc3MgTmV3U2xpZGVVbmRvSXRlbXtcbiAgICBjb25zdHJ1Y3RvcihzbGlkZUluZGV4KXtcbiAgICAgICAgdGhpcy5zbGlkZUluZGV4ID0gc2xpZGVJbmRleDtcbiAgICAgICAgdGhpcy50eXBlID0gTkVXU0xJREU7XG4gICAgfVxufVxuXG5jbGFzcyBEZWxheVVuZG9JdGVte1xuICAgIGNvbnN0cnVjdG9yKHdhaXRUaW1lKXtcbiAgICAgICAgdGhpcy53YWl0VGltZSA9IHdhaXRUaW1lO1xuICAgICAgICB0aGlzLnR5cGUgPSBERUxBWTtcbiAgICB9XG59XG5cbmV4cG9ydCB7IE5vbkRlY3JlYXNpbmdEaXJlY3RvciwgRGlyZWN0aW9uQXJyb3csIFVuZG9DYXBhYmxlRGlyZWN0b3IgfTtcbiJdLCJuYW1lcyI6WyJNYXRoIiwidGhyZWVFbnZpcm9ubWVudCIsIm1hdGgubGVycFZlY3RvcnMiLCJyZXF1aXJlIiwicmVxdWlyZSQkMCIsInJlcXVpcmUkJDEi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QUFJLEtBQUssR0FBRyxDQUFDLENBQUM7Q0FDbEIsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztDQUM1QyxJQUFJO0NBQ0osR0FBRyxLQUFLLEdBQUcsSUFBSSxDQUFDLGFBQWEsSUFBSSxDQUFDLENBQUM7Q0FDbkM7Q0FDQSxHQUFHLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0NBQzVDLElBQUksSUFBSSxFQUFFLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0NBQ3RHLElBQUksSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7Q0FDN0MsS0FBSyxJQUFJLEVBQUUsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7Q0FDdkcsS0FBSyxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7Q0FDOUMsS0FBSyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztDQUM5QyxLQUFLO0NBQ0wsSUFBSTtDQUNKLEdBQUcsS0FBSyxHQUFHLElBQUksQ0FBQyxhQUFhLElBQUksQ0FBQyxDQUFDO0NBQ25DO0NBQ0EsR0FBRyxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztDQUM1QyxJQUFJLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztDQUN0RyxJQUFJLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0NBQzdDLEtBQUssSUFBSSxFQUFFLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFD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QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPQSxlQUFPLEVBQUUsVUFBVSxFQUFFQSxlQUFPLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxTQUFTLFlBQVksRUFBRSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLFVBQVMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxZQUFZLENBQUMsWUFBWSxDQUFDLFlBQVksQ0FBQyxZQUFZLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxlQUFlLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sU0FBUyxDQUFDLDZCQUE2QixDQUFDLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsT0FBTyxJQUFJLENBQUMsQ0FBQyxZQUFZLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxTQUFTLElBQUksQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLEdBQUcsT0FBTyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsWUFBWSxLQUFLLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxHQUFHLENBQUMsSUFBSSxLQUFLLENBQUMsd0NBQXdDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxPQUFPLEtBQUssQ0FBQyxHQUFHLFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE9BQU8sU0FBUyxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxRQUFRLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksRUFBQyxDQUFDLENBQUMsS0FBSyxHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFDLENBQUMsT0FBTyxJQUFJLENBQUMsQ0FBQyxZQUFZLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxTQUFTLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sU0FBUyxDQUFDLDZCQUE2QixDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsUUFBUSxDQUFDLEtBQUssR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDLEtBQUssSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsY0FBYSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLG9CQUFtQixDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsK0NBQStDLENBQUMscUNBQXFDLENBQUMsa0RBQWtELENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLE9BQU8sT0FBTyxDQUFDLEtBQUssR0FBRyxVQUFVLENBQUMsQ0FBQyxPQUFPLENBQUMsS0FBSyxHQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sSUFBSSxDQUFDLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsU0FBUyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsQ0FBQyxNQUFNLFNBQVMsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxJQUFJLENBQUMsQ0FBQyxZQUFZLENBQUMsU0FBUyxDQUFDLGNBQWMsQ0FBQyxTQUFTLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sU0FBUyxDQUFDLDZCQUE2QixDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksR0FBRyxRQUFRLEVBQUUsVUFBVSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQyxDQUFDLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBQyxDQUFDLEtBQUssR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsUUFBUSxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsUUFBUSxDQUFDLENBQUMsQ0FBQyxPQUFPLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksRUFBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBQyxDQUFDLE9BQU8sSUFBSSxDQUFDLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQyxTQUFTLElBQUksQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLElBQUksQ0FBQyxHQUFHLFNBQVMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxHQUFHLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsR0FBRyxHQUFHLGdCQUFnQixDQUFDLFNBQVMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsRUFBQyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsVUFBVSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFDLENBQUMsS0FBSyxHQUFHLFNBQVMsQ0FBQyxDQUFDLE1BQU0sU0FBUyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBQyxDQUFDLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLElBQUksQ0FBQyxDQUFDLFlBQVksQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDLFNBQVMsSUFBSSxDQUFDLENBQUMsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsS0FBSyxHQUFHLFVBQVUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssR0FBRyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUMsT0FBTyxHQUFHLENBQUMsQ0FBQyxZQUFZLENBQUMsU0FBUyxDQUFDLGFBQWEsQ0FBQyxTQUFTLElBQUksQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksVUFBVSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxVQUFVLENBQUMsVUFBVSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxHQUFHLFVBQVUsQ0FBQyxPQUFPLFVBQVUsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsYUFBYSxDQUFDLFNBQVMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sT0FBTyxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLFNBQVMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sT0FBTyxHQUFHLEdBQUcsVUFBVSxDQUFDLFNBQVMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sT0FBTyxHQUFHLEdBQUcsUUFBUSxDQUFDLFNBQVMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sT0FBTyxHQUFHLEdBQUcsUUFBUSxFQUFFLEdBQUcsR0FBRyxJQUFJLENBQUMsU0FBUyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxHQUFHLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLFFBQVEsQ0FBQyxPQUFPLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxPQUFPLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxTQUFTLFNBQVMsRUFBRSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLE9BQU8sR0FBRSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksVUFBVSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFFLEVBQUUsU0FBUyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFDLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDLFNBQVMsR0FBRyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsTUFBTSxFQUFFLFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLElBQUcsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsYUFBYSxDQUFDLFNBQVMsTUFBTSxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLFNBQVMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxDQUFDLFNBQVMsVUFBVSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxVQUFTLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsU0FBUyxZQUFZLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLEVBQUUsRUFBQyxDQUFDLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsU0FBUyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBQyxDQUFDLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsU0FBUyxZQUFZLENBQUMsQ0FBQyxHQUFHLFlBQVksRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFZLENBQUMsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxTQUFTLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTSxDQUFDLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsU0FBUyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLE1BQUssQ0FBQyxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLFNBQVMsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGdCQUFnQixHQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFLLENBQUMsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsRUFBRSxFQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxTQUFTLE9BQU8sQ0FBQyxDQUFDLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBTyxDQUFDLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsU0FBUyxNQUFNLENBQUMsQ0FBQyxHQUFHLE1BQU0sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTSxDQUFDLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxnQkFBZ0IsQ0FBQyxTQUFTLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBTyxDQUFDLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVLENBQUMsT0FBTyxJQUFJLENBQUMsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsUUFBUSxFQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksUUFBUSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsYUFBYSxFQUFFLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLFdBQVcsR0FBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxHQUFHLElBQUksRUFBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxHQUFFLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksRUFBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxTQUFTLElBQUksQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBSyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxTQUFTLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssNEJBQTRCLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxTQUFTLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksVUFBVSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLFVBQVUsQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxFQUFFLFNBQVMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsRUFBRSxTQUFTLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFDLE9BQU0sQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEFBQW1CLElBQUksTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBSyxDQUFDLENBQUMsT0FBTyxNQUFNLENBQUMsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLGNBQWMsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQyxNQUFNLEdBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLG1CQUFtQixDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxFQUFDLENBQUMsSUFBSSxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLGNBQWMsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLFVBQVUsRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLGdCQUFnQixDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBQyxDQUFDLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsU0FBUyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQyxHQUFHLEVBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFVLENBQUMsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLFNBQVMsVUFBVSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLElBQUksWUFBWSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLElBQUksVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLElBQUksVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksT0FBTyxDQUFDLElBQUksVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxPQUFPLENBQUMsSUFBSSxRQUFRLENBQUMsQ0FBQyxDQUFDLElBQUksT0FBTyxDQUFDLElBQUksU0FBUyxDQUFDLEtBQUssQ0FBQyxJQUFJLFdBQVcsQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLFNBQVMsUUFBUSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxPQUFPLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUMsQ0FBQyxTQUFTLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLElBQUksRUFBQyxDQUFDLFNBQVMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBQyxDQUFDLFNBQVMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsU0FBUyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxTQUFTLEVBQUUsR0FBRyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsSUFBSSxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxTQUFTLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLFVBQVUsQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLFFBQVEsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFLLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUMsQ0FBQyxTQUFTLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxTQUFTLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBQyxDQUFDLENBQUMsU0FBUyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTSxDQUFDLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDLFNBQVMsU0FBUyxFQUFFLENBQUMsR0FBRyxTQUFTLEdBQUcsQ0FBQyxDQUFDLE9BQU8sR0FBRyxDQUFDLEVBQUUsU0FBUyxDQUFDLElBQUksR0FBRyxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDLE9BQU8sR0FBRyxDQUFDLEdBQUcsQ0FBQyxTQUFTLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsU0FBUyxFQUFFLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxHQUFHLFFBQVEsQ0FBQyxDQUFDLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsS0FBSyxTQUFTLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxNQUFNLENBQUMsTUFBTSxRQUFRLEVBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsU0FBUyxHQUFHLENBQUMsQ0FBQyxRQUFRLEVBQUUsRUFBQyxDQUFDLEdBQUcsUUFBUSxDQUFDLE9BQU8sRUFBRSxTQUFTLENBQUMsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxNQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsTUFBTSxDQUFDLEdBQUcsTUFBTSxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxLQUFLLE9BQU8sQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksRUFBRSxPQUFPLENBQUMsQ0FBQyxNQUFNLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxTQUFTLEdBQUcsQ0FBQyxDQUFDLFFBQVEsRUFBRSxFQUFDLENBQUMsVUFBVSxDQUFDLElBQUksRUFBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFVLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLE9BQU8sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksWUFBWSxDQUFDLENBQUMsQ0FBQyxJQUFJLFlBQVksQ0FBQyxFQUFFLENBQUMsSUFBSSxPQUFPLENBQUMsQ0FBQyxFQUFFLFlBQVksQ0FBQyxJQUFJLFVBQVUsQ0FBQyxFQUFFLENBQUMsQUFBd0IsSUFBSSxTQUFTLENBQUMsRUFBRSxDQUFDLElBQUksSUFBSSxDQUFDLE9BQU8sRUFBRSxTQUFTLENBQUMsSUFBSSxTQUFTLENBQUMsT0FBTyxFQUFFLFVBQVUsQ0FBQyxTQUFTLENBQUMsSUFBSSxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQyxJQUFJLGVBQWUsQ0FBQyxDQUFDLENBQUMsSUFBSSxVQUFVLENBQUMsQ0FBQyxFQUFFLGVBQWUsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLElBQUksU0FBUyxDQUFDLEVBQUUsQ0FBQyxJQUFJLGNBQWMsQ0FBQyxFQUFFLENBQUMsSUFBSSxTQUFTLENBQUMsQ0FBQyxFQUFFLGNBQWMsQ0FBQyxBQUFhLElBQUksWUFBWSxDQUFDLENBQUMsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxDQUFDLEVBQUUsWUFBWSxDQUFDLElBQUksY0FBYyxDQUFDLGNBQWMsQ0FBQyxZQUFZLENBQUMsSUFBSSxZQUFZLENBQUMsQ0FBQyxFQUFFLGNBQWMsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsSUFBSSxlQUFlLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxTQUFTLFFBQVEsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxPQUFPLENBQUMsSUFBSSxRQUFRLENBQUMsSUFBSSxJQUFJLENBQUMsSUFBSSxJQUFJLENBQUMsSUFBSSxRQUFRLENBQUMsU0FBUyxJQUFJLEVBQUUsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxVQUFVLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFFBQVEsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLFlBQVksQ0FBQyxDQUFDLEVBQUUsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxDQUFDLFNBQVMsU0FBUyxFQUFFLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxZQUFZLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLFlBQVksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsWUFBWSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFDLENBQUMsQ0FBQyxTQUFTLFdBQVcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFTLENBQUMsU0FBUyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFZLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsYUFBWSxDQUFDLENBQUMsQ0FBQyxTQUFTLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLElBQUksU0FBUyxDQUFDLEtBQUssQ0FBQyxJQUFJLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLFdBQVcsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBQyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLFlBQVksQ0FBQyxZQUFZLENBQUMsQ0FBQyxHQUFHLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxFQUFDLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsUUFBUSxFQUFFLFdBQVUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBRSxTQUFTLENBQUMsT0FBTyxXQUFXLENBQUMsU0FBUyxRQUFRLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxHQUFHLFFBQVEsRUFBRSxXQUFXLENBQUMsQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsRUFBQyxDQUFDLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBUyxDQUFDLFNBQVMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLEtBQUssQ0FBQyxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sSUFBSSxDQUFDLFNBQVMsS0FBSyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxXQUFXLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLFlBQVksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLENBQUMsRUFBRSxZQUFZLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxNQUFNLEVBQUUsZUFBZSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsT0FBTyxFQUFFLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLEdBQUcsV0FBVyxDQUFDLGVBQWUsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUMsQ0FBQyxLQUFLLEdBQUcsV0FBVyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLE9BQU0sQ0FBQyxLQUFLLEdBQUcsV0FBVyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLE9BQU0sQ0FBQyxLQUFLLEdBQUcsV0FBVyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLE9BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxPQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsR0FBRyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxHQUFHLFlBQVksQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLEdBQUcsR0FBRyxFQUFFLFdBQVcsQ0FBQyxHQUFHLEVBQUUsV0FBVyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssR0FBRyxDQUFDLENBQUMsQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLFFBQVEsQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLGVBQWUsQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLE9BQU8sRUFBRSxHQUFHLENBQUMsR0FBRyxDQUFDLEVBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxhQUFhLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxRQUFRLEdBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxTQUFTLFdBQVcsRUFBRSxDQUFDLElBQUksR0FBRyxDQUFDLEVBQUUsQ0FBQyxJQUFJLEtBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBQyxDQUFDLE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBUyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsU0FBUSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxPQUFPLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyw2RkFBNkYsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksRUFBRSxRQUFRLENBQUMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsU0FBUyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxVQUFVLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLGtCQUFrQixDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLFFBQVEsQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLFFBQU8sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLFlBQVksQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLFNBQVMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksSUFBSSxHQUFHLElBQUksTUFBTSxDQUFDLENBQUMsR0FBRyxPQUFPLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsRUFBQyxDQUFDLFNBQVMsSUFBSSxFQUFFLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFLLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLE9BQU8sS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxjQUFjLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsU0FBUyxJQUFJLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsT0FBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLGlCQUFpQixDQUFDLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLFNBQVMsVUFBVSxDQUFDLENBQUMsSUFBSSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsWUFBWSxDQUFDLGVBQWUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxHQUFHLElBQUksUUFBUSxDQUFDLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsR0FBRyxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQUssQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsU0FBUyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxJQUFJLENBQUMsT0FBTyxFQUFFLElBQUksR0FBRyxHQUFHLEdBQUcsT0FBTyxFQUFFLEdBQUcsR0FBRyxRQUFRLENBQUMsQ0FBQyxDQUFDLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLFNBQVMsT0FBTyxDQUFDLENBQUMsSUFBSSxHQUFHLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLElBQUksR0FBRyxJQUFJLE9BQU8sQ0FBQyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxTQUFTLEtBQUssQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBQyxDQUFDLE9BQU8sT0FBTyxDQUFDLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsU0FBUyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsR0FBRyxDQUFDLEdBQUcsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFFLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLElBQUksR0FBRyxJQUFJLGFBQWEsQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLEVBQUUsYUFBYSxDQUFDLEdBQUcsRUFBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBQyxDQUFDLEdBQUcsT0FBTyxTQUFTLEdBQUcsV0FBVyxFQUFFLFNBQVMsR0FBRyxJQUFJLEVBQUUsS0FBSyxZQUFZLFNBQVMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUksQ0FBQyxLQUFLLEdBQUcsT0FBTyx3QkFBd0IsR0FBRyxXQUFXLEVBQUUsd0JBQXdCLEdBQUcsSUFBSSxFQUFFLEtBQUssWUFBWSx3QkFBd0IsRUFBRSxPQUFPLHFCQUFxQixHQUFHLFdBQVcsRUFBRSxxQkFBcUIsR0FBRyxJQUFJLEVBQUUsS0FBSyxZQUFZLHFCQUFxQixDQUFDLENBQUMsR0FBRyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssRUFBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQUssQ0FBQyxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUMsVUFBVSxFQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxLQUFLLEVBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxNQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxJQUFJLEtBQUssQ0FBQyxlQUFlLENBQUMsQ0FBQyxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLE1BQU0sSUFBSSxLQUFLLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQyxNQUFNLElBQUksS0FBSyxDQUFDLGlEQUFpRCxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUMsQ0FBQyxPQUFPLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLGVBQWUsR0FBRSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsZUFBZSxHQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsSUFBSSxNQUFNLENBQUMsTUFBTSxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxHQUFHLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxTQUFTLEdBQUUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQUMsSUFBTSxVQUFVLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsR0FBRyxFQUFFLFVBQVUsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsR0FBRyxFQUFFLFVBQVUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUFDLENBQUMsT0FBTyxPQUFPLENBQUMsRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLFNBQVMsS0FBSyxDQUFDLENBQUMsT0FBTyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxTQUFTLEtBQUssQ0FBQyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sS0FBSyxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxPQUFPLEtBQUssQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLE9BQU8sVUFBVSxDQUFDLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxhQUFhLENBQUMsU0FBUyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLHlCQUF5QixDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLEdBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUMsSUFBSSxDQUFDLE9BQU8sSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLEtBQUssQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLE9BQU0sQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsZ0NBQWdDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsT0FBTSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsS0FBSyxDQUFDLFNBQVEsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsTUFBTSxJQUFJLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLGlCQUFpQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxNQUFNLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsU0FBUyxHQUFHLENBQUMsQ0FBQyxPQUFPLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLFNBQVMsS0FBSyxDQUFDLENBQUMsSUFBSSxHQUFHLENBQUMsR0FBRyxJQUFJLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU0sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsU0FBUyxLQUFLLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEdBQUcsUUFBUSxDQUFDLENBQUMsR0FBRyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBQyxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sSUFBSSxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUMsT0FBTyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsRUFBRSxTQUFTLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxPQUFPLEdBQUcsQ0FBQyxDQUFDLFlBQVksRUFBQyxDQUFDLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLE9BQU8sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxVQUFVLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxXQUFXLENBQUMsU0FBUyxLQUFLLENBQUMsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsSUFBSSxVQUFVLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyxLQUFLLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxXQUFXLEdBQUUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxNQUFLLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsTUFBTSxHQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLGdCQUFnQixHQUFFLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsR0FBRyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENB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QUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7Q0FDL0QsU0FBUztDQUNUO0NBQ0EsS0FBSztDQUNMLElBQUksa0JBQWtCLENBQUMsV0FBVyxFQUFFLEtBQUssQ0FBQztDQUMxQztDQUNBLFFBQVEsSUFBSSxDQUFDLHFCQUFxQixDQUFDLFdBQVcsRUFBRSxLQUFLLENBQUMsQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO0NBQzNFLEtBQUs7Q0FDTCxJQUFJLHFCQUFxQixDQUFDLFdBQVcsRUFBRSxXQUFXLEVBQUUsV0FBVyxFQUFFLFdBQVcsQ0FBQztDQUM3RTtDQUNBLFFBQVEsSUFBSSxVQUFVLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQztDQUMvRCxRQUFRLElBQUksS0FBSyxHQUFHLFdBQVcsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDOztDQUV4QyxRQUFRLFVBQVUsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFDLEdBQUcsV0FBVyxDQUFDO0NBQzVDLFFBQVEsVUFBVSxDQUFDLEtBQUssR0FBRyxDQUFDLENBQUMsR0FBRyxXQUFXLENBQUM7Q0FDNUMsUUFBUSxVQUFVLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQyxHQUFHLFdBQVcsQ0FBQzs7Q0FFNUMsUUFBUSxVQUFVLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQyxHQUFHLFdBQVcsQ0FBQztDQUM1QyxRQUFRLFVBQVUsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFDLEdBQUcsV0FBVyxDQUFDO0NBQzVDLFFBQVEsVUFBVSxDQUFDLEtBQUssR0FBRyxDQUFDLENBQUMsR0FBRyxXQUFXLENBQUM7O0NBRTVDLFFBQVEsVUFBVSxDQUFDLEtBQUssR0FBRyxDQUFDLENBQUMsR0FBRyxXQUFXLENBQUM7Q0FDNUMsUUFBUSxVQUFVLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQyxHQUFHLFdBQVcsQ0FBQztDQUM1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Q0FDQSxJQUFJLEdBQUcsQ0FBQyxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0NBQ3BDLEtBQUssQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQztDQUM1QyxLQUFLLElBQUk7Q0FDVDtDQUNBLEtBQUssQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQztDQUM1QyxLQUFLLGNBQWMsSUFBSSxDQUFDLENBQUMsQ0FBQztDQUMxQixLQUFLOztDQUVMO0NBQ0E7Q0FDQSxJQUFJLFFBQVEsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7Q0FDbEo7Q0FDQSxJQUFJLFFBQVEsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFD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
