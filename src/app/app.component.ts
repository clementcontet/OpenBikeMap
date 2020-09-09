import {Component, OnInit} from '@angular/core';
import GeoJSON from 'ol/format/GeoJSON';
import {singleClick} from 'ol/events/condition';
import Map from 'ol/Map';
import View from 'ol/View';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import Feature from 'ol/Feature';
import SimpleGeometry from 'ol/geom/SimpleGeometry';
import VectorLayer from 'ol/layer/Vector';
import {Circle as CircleStyle, Fill, Stroke, Style} from 'ol/style';
import {Draw, Modify, Select, Snap, defaults as defaultInteractions} from 'ol/interaction';
import {OSM, Vector} from 'ol/source';
import * as olProj from 'ol/proj';
import TileLayer from 'ol/layer/Tile';

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

    const source = new Vector();
    source.addFeatures(new GeoJSON({featureProjection: 'EPSG:3857'}).readFeatures(bellecour));
    source.addFeatures(new GeoJSON({featureProjection: 'EPSG:3857'}).readFeatures(quais));

    source.on('change', e => {
      console.log(`change with number of points : ${source.getFeatures().map(feature => (feature.getGeometry() as SimpleGeometry).getCoordinates().length)}`);
    });

    const vector = new VectorLayer({
      source,
      style: new Style({
        stroke: new Stroke({color: '#ff7900', width: 6}),
        image: new CircleStyle({
          radius: 10, fill: new Fill({color: '#ff0000'}),
        }),
      }),
    });

    const snap = new Snap({source});
    const select = new Select({source});
    // const modify = new Modify({source});
    const draw = new Draw({source, type: 'LineString'});

    const map = new Map({
      interactions: defaultInteractions().extend([
        snap,
        select,
        // modify,
        // draw,
      ]),
      target: 'hotel_map',
      layers: [new TileLayer({source: new OSM()}), vector],
      view: new View({
        center: olProj.fromLonLat([4.832, 45.758]),
        zoom: 15
      })
    });

    select.on('select', (selectionEvent) => {
      const features = selectionEvent.target.getFeatures();
      const localModify = new Modify({features});
      map.addInteraction(localModify);
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
