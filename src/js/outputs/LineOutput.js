import {OutputNode} from '../Node.js';
import { getThreeEnvironment } from '../ThreeEnvironment.js';
import { vShader, fShader, uniforms } from './LineOutputShaders.js';

const WIDTH_FUDGE_FACTOR = 10;

class LineOutput extends OutputNode{
	constructor(options = {}){
		super();
		/* should be .add()ed to a Transformation to work.
        Crisp lines using the technique in https://mattdesl.svbtle.com/drawing-lines-is-hard.
			options:
			{
				width: number
				opacity: number
				color: hex code or THREE.Color()
			}
		*/

		this._width = options.width !== undefined ? options.width : 5;
		this._opacity = options.opacity !== undefined ? options.opacity : 1;
		this._color = options.color !== undefined ? new THREE.Color(options.color) : new THREE.Color(0x55aa55);

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
			}
		}

		this.material = new THREE.ShaderMaterial({
			side: THREE.BackSide,
			vertexShader: vShader, 
			fragmentShader: fShader,
			uniforms: this._uniforms,
	    });

		this.mesh = new THREE.Mesh(this._geometry,this.material);

		this.opacity = this._opacity; // setter sets transparent flag if necessary
		this.color = this._color; //setter sets color uniform
		this._uniforms.opacity.value = this._opacity;
		this._uniforms.color.value = this._color;
		this._uniforms.thickness.value = this._width / WIDTH_FUDGE_FACTOR;

		getThreeEnvironment().scene.add(this.mesh);
	}

	makeGeometry(){
		// follow http://blog.cjgammon.com/threejs-geometry
		// or mathbox's lineGeometry
		const MAX_POINTS = 10000;
        const NUM_POINTS_PER_VERTEX = 2;

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
		//this._geometry.addAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
		//this.geometry.addAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );


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


        // Why use (this.numCallsPerActivation-1)*2? 
        // We want to render a chain with n points, each connected to the one in front of it by a line except the last one. Then because the last vertex doesn't introduce a new line, there are n-1 lines between the chain points.
        // Each line is rendered using two vertices. So we multiply the number of lines, this.numCallsPerActivation-1, by two.
        const NUM_POINTS_PER_LINE_SEGMENT = 2;
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
        for(var i=0; i<numVerts;i++){
            direction[i] = i%2==0 ? 1 : -1; //alternate -1 and 1
        }
		this._geometry.addAttribute( 'direction', new THREE.Float32BufferAttribute( direction, 1) );

		//indices

        /*
        For each vertex, we connect it to the next vertex like this:
        n --n+2
        |  /  |
       n+1 --n+3 
        then we advance n two at a time to move to the next vertex. vertices n, n+1 represent the same point;
        they're separated in the vertex shader to a constant screenspace width */
        let indices = [];
		for(let vertNum=0;vertNum<numVerts-2;vertNum +=2){ //not sure why this -3 is there. i guess it stops vertNum+3 two lines down from going somewhere it shouldn't?
        	//indices.push( vertNum, vertNum+1, vertNum+2);
			//indices.push( vertNum+2,vertNum+1, vertNum+3);
        	indices.push( vertNum+1, vertNum, vertNum+2);
			indices.push( vertNum+1,vertNum+2, vertNum+3);
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

		let index = this._currentPointIndex*this._outputDimensions;

	    this._vertices[index]   = x === undefined ? 0 : x;
		this._vertices[index+1] = y === undefined ? 0 : y;
		this._vertices[index+2] = z === undefined ? 0 : z;
	    this._vertices[index+3] = this._vertices[index];
		this._vertices[index+4] = this._vertices[index+1]; //TODO: remove this debug
		this._vertices[index+5] = this._vertices[index+2];

		this._currentPointIndex++;

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
			this._prevPointVertices[index]   = this._vertices[index];
			this._prevPointVertices[index+1] = this._vertices[index+1];
			this._prevPointVertices[index+2] = this._vertices[index+2];

			this._prevPointVertices[index+3]  = this._vertices[index];
			this._prevPointVertices[index+4] = this._vertices[index+1];
			this._prevPointVertices[index+5] = this._vertices[index+2];
        }else{
            //set this thing's prevPoint to the previous vertex
			this._prevPointVertices[index] = this._vertices[index-this._outputDimensions*2];
			this._prevPointVertices[index+1] = this._vertices[index-this._outputDimensions*2+1];
			this._prevPointVertices[index+2] = this._vertices[index-this._outputDimensions*2+2];

			this._prevPointVertices[index+3] = this._prevPointVertices[index];
			this._prevPointVertices[index+4] = this._prevPointVertices[index+1];
			this._prevPointVertices[index+5] = this._prevPointVertices[index+2];


            //set the PREVIOUS point's nextPoint to to THIS vertex.
			this._nextPointVertices[index-this._outputDimensions*2] = this._vertices[index];
			this._nextPointVertices[index-this._outputDimensions*2+1] = this._vertices[index+1];
			this._nextPointVertices[index-this._outputDimensions*2+2] = this._vertices[index+2];

			this._nextPointVertices[index-this._outputDimensions*2+3] = this._vertices[index];
			this._nextPointVertices[index-this._outputDimensions*2+4] = this._vertices[index+1];
			this._nextPointVertices[index-this._outputDimensions*2+5] = this._vertices[index+2];
        }

        if(endingNewLine){
            //make the nextPoint be the same point as this
			this._nextPointVertices[index]   = this._vertices[index];
			this._nextPointVertices[index+1] = this._vertices[index+1];
			this._nextPointVertices[index+2] = this._vertices[index+2];

			this._nextPointVertices[index+3] = this._vertices[index];
			this._nextPointVertices[index+4] = this._vertices[index+1];
			this._nextPointVertices[index+5] = this._vertices[index+2];
        }


	    this._currentPointIndex++;
	}
	onAfterActivation(){
		let positionAttribute = this._geometry.attributes.position;
		positionAttribute.needsUpdate = true;
		let prevPointPositionAttribute = this._geometry.attributes.previousPointPosition;
		prevPointPositionAttribute.needsUpdate = true;
		let nextPointPositionAttribute = this._geometry.attributes.nextPointPosition;
		nextPointPositionAttribute.needsUpdate = true;

        //update aspect ratio. in the future perhaps this should only be changed when the aspect ratio changes so it's not being done per frame?
        this._uniforms.aspect.value = getThreeEnvironment().camera.aspect;

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
        colorArray[vertexIndex*3 + 0] = normalizedR;
        colorArray[vertexIndex*3 + 1] = normalizedG;
        colorArray[vertexIndex*3 + 2] = normalizedB;

        colorArray[vertexIndex*3 + 3] = normalizedR;
        colorArray[vertexIndex*3 + 4] = normalizedG;
        colorArray[vertexIndex*3 + 5] = normalizedB;

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
		this.material.transparent = opacity < 1;
		this.material.visible = opacity > 0;
		this._opacity = opacity;
        this._uniforms.opacity.value = opacity;
	}
	get opacity(){
		return this._opacity;
	}
	set width(width){
		this._width = width;
        this._uniforms.thickness.value = width / WIDTH_FUDGE_FACTOR;
	}
	get width(){
		return this._width;
	}
	clone(){
		return new LineOutput({width: this.width, color: this.color, opacity: this.opacity});
	}
}

export {LineOutput};
