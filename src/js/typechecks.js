var EXP = EXP || {};

EXP.Utils = class Utils{

	static isArray(x){
		return x.constructor === Array;
	}
	static isFunction(x){
		return x.constructor === Function;
	}

	static assert(thing){
		//A function to check if something is true and halt otherwise in a callbackable way.
		if(!thing){
			console.error("ERROR!");
		}
	}

	static assertType(thing, type){
		//A function to check if something is true and halt otherwise in a callbackable way.
		if(!thing.constructor === type){
			console.error("ERROR! Something not of type"+type);
		}
	}


	static assertPropExists(thing, name){
		if(!(name in thing)){
			console.error("ERROR! "+name+" not present in required property")
		}
	}
}

