import {Component, OnInit} from '@angular/core';
import GeoJSON from 'ol/format/GeoJSON';
import Map from 'ol/Map';
import View from 'ol/View';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import Feature from 'ol/Feature';
import SimpleGeometry from 'ol/geom/SimpleGeometry';
import AnimatedCluster from 'ol-ext/layer/AnimatedCluster';
import {Circle as CircleStyle, Fill, Stroke, Style} from 'ol/style';
import {Draw, Modify, Select, Snap, defaults as defaultInteractions} from 'ol/interaction';
import {OSM, Cluster} from 'ol/source';
import * as olProj from 'ol/proj';
import TileLayer from 'ol/layer/Tile';
import VectorSource from 'ol/source/Vector';
import {Control, Zoom} from 'ol/control';
import GeometryType from 'ol/geom/GeometryType';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})

// From https://openlayers.org/en/latest/examples/draw-and-modify-features.html
// and https://openlayers.org/en/latest/examples/modify-test.html
// and https://openlayers.org/workshop/en/vector/geojson.html

export class AppComponent implements OnInit {
  title = 'open-bike-map';

  ngOnInit() {
    const bellecour = {type: 'Feature', geometry: {type: 'Point', coordinates: [4.832, 45.758]}};
    const quais = {type: 'Feature', geometry: {type: 'LineString', coordinates: [[4.841, 45.759], [4.8415, 45.765]]}};

    const source = new VectorSource(
      // {
      //   format: new GeoJSON(),
      //   url: './assets/formes.json'
      // }
    );

    for (let x = 44; x < 46; x = x + 0.1) {
      for (let y = 3; y < 5; y = y + 0.1) {
        if (Math.random() > 0.9) {
          source.addFeature(new GeoJSON({featureProjection: 'EPSG:3857'}).readFeature(
            {type: 'Feature', geometry: {type: 'Point', coordinates: [y, x]}}
          ));
        }
        // if (Math.random() > 0.9) {
        //   source.addFeature(new GeoJSON({featureProjection: 'EPSG:3857'}).readFeature(
        //     {
        //       type: 'Feature',
        //       geometry: {
        //         type: 'LineString',
        //         coordinates: [
        //           [y + (-0.1) * Math.random(), x + (-0.1) * Math.random()],
        //           [y + (-0.1) * Math.random(), x + (-0.1) * Math.random()]
        //         ]
        //       }
        //     }
        //   ));
        // }
      }
    }

    // source.addFeatures(new GeoJSON({featureProjection: 'EPSG:3857'}).readFeatures(bellecour));
    // source.addFeatures(new GeoJSON({featureProjection: 'EPSG:3857'}).readFeatures(quais));

    source.on('change', e => {
      console.log(`change with number of points : ${source.getFeatures().map(feature => (feature.getGeometry() as SimpleGeometry).getCoordinates().length)}`);
    });

    const clusterSource = new Cluster({
      distance: 50,
      source,
    });

    const vector = new AnimatedCluster({
      source: clusterSource,
      style: new Style({
        stroke: new Stroke({color: '#ff7900', width: 6}),
        image: new CircleStyle({
          radius: 10, fill: new Fill({color: '#ff0000'}),
        }),
      }),
    });

    const select = new Select({features: source.getFeaturesCollection()});
    const draw = new Draw({source, type: GeometryType.LINE_STRING});
    const snap = new Snap({source});

    const map = new Map({
      interactions: defaultInteractions().extend([
        select,
        // draw,
      ]),
      target: 'hotel_map',
      layers: [new TileLayer({source: new OSM()}), vector],
      view: new View({
        center: olProj.fromLonLat([4.832, 45.758]),
        zoom: 15
      }),
      controls: [
        new Zoom(),
        new MyControl(draw),
      ],
    });

    select.on('select', (selectionEvent) => {
      const features = selectionEvent.target.getFeatures();
      const localModify = new Modify({features});
      map.addInteraction(localModify);
      map.addInteraction(snap);
      localModify.on('modifyend', () => {
        features.forEach(feature => {
          removeDuplicates(feature);
        });
      });
      localModify.on('error', e => {
        console.log('Erreur: ' + JSON.stringify(e));
      });
    });
  }
}

function removeDuplicates(feature: Feature) {
  const geometry = feature.getGeometry();
  if (geometry.getType() === 'LineString') {
    const coordinates = (geometry as LineString).getCoordinates();
    let x = 0;
    let y = 0;
    let shouldModify = false;
    const newCoordinates = coordinates.filter((coord) => {
      const shouldAdd = coord[0] !== x || coord[1] !== y;
      if (!shouldAdd) {
        shouldModify = true;
      }
      x = coord[0];
      y = coord[1];
      return shouldAdd;
    });
    if (shouldModify && coordinates.length > 2) {
      (geometry as LineString).setCoordinates(newCoordinates);
    }
  }
}


export class MyControl extends Control {
  constructor(draw: Draw) {
    let drawEnabled = false;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ol-control';
    button.innerHTML = 'Activer l\'ajout';
    const element = document.createElement('div');
    element.className = 'ol-feature ol-control';
    element.appendChild(button);
    button.addEventListener('click', () => {
      if (drawEnabled) {
        console.log((this as Control).getMap().removeInteraction(draw));
        button.innerHTML = 'Activer l\'ajout';
      } else {
        console.log((this as Control).getMap().addInteraction(draw));
        button.innerHTML = 'Désactiver l\'ajout';
      }
      drawEnabled = !drawEnabled;
    });
    super({element});
  }
}
