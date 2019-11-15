import { Utils } from './utils.js';

import { Transformation } from './Transformation.js';

import * as math from './math.js';
import { threeEnvironment } from './ThreeEnvironment.js';

let EPS = Number.EPSILON;

class Animation{
	constructor(target, toValues, duration, staggerFraction){
		Utils.assertType(toValues, Object);

		this.toValues = toValues;
		this.target = target;	
		this.staggerFraction = staggerFraction === undefined ? 0 : staggerFraction; // time in ms between first element beginning the animation and last element beginning the animation. Should be less than duration.
r

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
		this._updateCallback = this.update.bind(this)
		threeEnvironment.on("update",this._updateCallback);
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

		var newValue = null;
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
				return math.lerpVectors(t,toValue(...coords),fromValue(...coords))
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
		threeEnvironment.removeEventListener("update",this._updateCallback);
		//Todo: delete this
	}
}

//todo: put this into a Director class so that it can have an undo stack
function TransitionTo(target, toValues, durationMS, staggerFraction){
	var animation = new Animation(target, toValues, durationMS === undefined ? undefined : durationMS/1000, staggerFraction);
}

export {TransitionTo, Animation}
