/**
 * @author mrdoob / http://mrdoob.com/
 * @author Mugen87 / https://github.com/Mugen87
 */

THREE.OBJLoader = ( function () {

	function OBJLoader( manager ) {

		this.manager = ( manager !== undefined ) ? manager : THREE.DefaultLoadingManager;
		this.materials = null;

	}

	OBJLoader.prototype = {

		constructor: OBJLoader,

		load: function ( url, onLoad, onProgress, onError ) {

			var scope = this;

			var loader = new THREE.FileLoader( scope.manager );
			loader.setPath( scope.path );
			loader.load( url, function ( text ) {

				onLoad( scope.parse( text ) );

			}, onProgress, onError );

		},

		setPath: function ( value ) {

			this.path = value;
			return this;

		},

		setMaterials: function ( materials ) {

			this.materials = materials;
			return this;

		},

		parse: function ( text ) {

			console.time( 'OBJLoader' );

			var object, geometry, material;

			function parseObject( name ) {

				object = new THREE.Group();
				object.name = name;

			}

			parseObject( '' );

			var lines = text.split( '\n' );
			var vertices = [];
			var normals = [];
			var uvs = [];

			for ( var i = 0, l = lines.length; i < l; i ++ ) {

				var line = lines[ i ].trim();

				if ( line.length === 0 || line.charAt( 0 ) === '#' ) continue;

				var elements = line.split( /\s+/ );
				var command = elements.shift();

				switch ( command ) {

					case 'v':
						vertices.push(
							parseFloat( elements[ 0 ] ),
							parseFloat( elements[ 1 ] ),
							parseFloat( elements[ 2 ] )
						);
						break;

					case 'vt':
						uvs.push(
							parseFloat( elements[ 0 ] ),
							1 - parseFloat( elements[ 1 ] )
						);
						break;

					case 'vn':
						normals.push(
							parseFloat( elements[ 0 ] ),
							parseFloat( elements[ 1 ] ),
							parseFloat( elements[ 2 ] )
						);
						break;

					case 'f':
						if ( geometry === undefined ) {
							geometry = new THREE.BufferGeometry();
							var position = [];
							var normal = [];
							var uv = [];
						}

						for ( var j = 0, jl = elements.length; j < jl; j ++ ) {

							var vertexData = elements[ j ].split( '/' );

							var vert = vertexData[ 0 ] - 1;
							position.push(
								vertices[ vert * 3 ],
								vertices[ vert * 3 + 1 ],
								vertices[ vert * 3 + 2 ]
							);

							if ( vertexData[ 1 ] ) {
								var uvVert = vertexData[ 1 ] - 1;
								uv.push(
									uvs[ uvVert * 2 ],
									uvs[ uvVert * 2 + 1 ]
								);
							}

							if ( vertexData[ 2 ] ) {
								var normVert = vertexData[ 2 ] - 1;
								normal.push(
									normals[ normVert * 3 ],
									normals[ normVert * 3 + 1 ],
									normals[ normVert * 3 + 2 ]
								);
							}

						}

						break;

				}

			}

			if ( geometry !== undefined ) {

				geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( position, 3 ) );
				if ( uv.length > 0 ) geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uv, 2 ) );
				if ( normal.length > 0 ) geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normal, 3 ) );

				material = new THREE.MeshStandardMaterial( { color: 0xffffff } );
				var mesh = new THREE.Mesh( geometry, material );
				object.add( mesh );

			}

			console.timeEnd( 'OBJLoader' );

			return object;

		}

	};

	return OBJLoader;

} )();
