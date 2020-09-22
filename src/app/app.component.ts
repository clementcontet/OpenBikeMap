import {Component, OnInit} from '@angular/core';
import {createEmpty, extend, Extent} from 'ol/extent';
import GeoJSON from 'ol/format/GeoJSON';
import Feature from 'ol/Feature';
import Map from 'ol/Map';
import View from 'ol/View';
import GeometryType from 'ol/geom/GeometryType';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import SimpleGeometry from 'ol/geom/SimpleGeometry';
import * as sphere from 'ol/sphere';
import {Control, Zoom} from 'ol/control';
import {Draw, Modify, Select, Snap, defaults as defaultInteractions} from 'ol/interaction';
import {OSM, Cluster} from 'ol/source';
import VectorSource from 'ol/source/Vector';
import * as olProj from 'ol/proj';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import {Circle as CircleStyle, Fill, Stroke, Style, Text} from 'ol/style';
import AnimatedCluster from 'ol-ext/layer/AnimatedCluster';

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
  private readonly clusterThresholdZoom = 11;
  private readonly clusterSpacing = 100;
  // private totalPathsDistance: number;
  // private totalExtent: Extent;
  // private averagePathsDensity: number;
  private pathsDetailsSource = new VectorSource();
  private pathsCentersSource = new VectorSource();
  private clustersSource: Cluster;

  ngOnInit() {
    // this.totalPathsDistance = 0;
    // this.totalExtent = createEmpty();

    // france
    for (let long = -1.4; long < 7.7; long = long + 0.1) {
      for (let lat = 43.4; lat < 48.9; lat = lat + 0.1) {
        if (Math.random() > 0.95) {
          const longStart = long + 0.1 * Math.random();
          const longEnd = long + 0.1 * Math.random();
          const latStart = lat + 0.1 * Math.random();
          const latEnd = lat + 0.1 * Math.random();
          this.addLine(longStart, latStart, longEnd, latEnd);
        }
      }
    }

    // lyon
    for (let long = 4.78; long < 4.95; long = long + 0.01) {
      for (let lat = 45.70; lat < 45.82; lat = lat + 0.01) {
        if (Math.random() > 0.8) {
          const longStart = long + 0.01 * Math.random();
          const longEnd = long + 0.01 * Math.random();
          const latStart = lat + 0.01 * Math.random();
          const latEnd = lat + 0.01 * Math.random();
          this.addLine(longStart, latStart, longEnd, latEnd);
        }
      }
    }

    // paris
    for (let long = 2.24; long < 2.41; long = long + 0.01) {
      for (let lat = 48.83; lat < 48.89; lat = lat + 0.01) {
        if (Math.random() > 0.8) {
          const longStart = long + 0.01 * Math.random();
          const longEnd = long + 0.01 * Math.random();
          const latStart = lat + 0.01 * Math.random();
          const latEnd = lat + 0.01 * Math.random();
          this.addLine(longStart, latStart, longEnd, latEnd);
        }
      }
    }

    this.addLine(4.841, 45.759, 4.8415, 45.765); // quais de rhône
    this.pathsDetailsSource.addFeatures(new GeoJSON({featureProjection: 'EPSG:3857'}).readFeatures(
      {type: 'Feature', geometry: {type: 'Point', coordinates: [4.832, 45.758]}} // bellecour
    ));

    // this.averagePathsDensity = this.totalPathsDistance / getArea(this.totalExtent);

    this.pathsDetailsSource.on('change', () => {
      console.log(`change with number of points : ${this.pathsDetailsSource.getFeatures().map(feature => (feature.getGeometry() as SimpleGeometry).getCoordinates().length)}`);
    });

    this.clustersSource = new Cluster({
      distance: this.clusterSpacing,
      source: this.pathsCentersSource,
    });

    const clustersLayer = new AnimatedCluster({
      source: this.clustersSource,
      maxZoom: this.clusterThresholdZoom,
      style: (clusterFeature: Feature, resolution: number) => this.getClusterStyle(clusterFeature, resolution),
    });

    const pathsLayer = new VectorLayer({
      source: this.pathsDetailsSource,
      minZoom: this.clusterThresholdZoom,
      style: new Style({
        stroke: new Stroke({color: '#ff7900', width: 6}),
        image: new CircleStyle({
          radius: 10, fill: new Fill({color: '#ff0000'}),
        })
      }),
    });

    const pathSelect = new Select({layers: [pathsLayer]});
    const clusterSelect = new Select({
      layers: [clustersLayer],
      condition: (evt => evt.type === 'pointermove' || evt.type === 'singleclick'),
      style: (clusterFeature: Feature) => this.selectStyleFunction(clusterFeature),
    });
    const draw = new Draw({source: this.pathsDetailsSource, type: GeometryType.LINE_STRING});
    const snap = new Snap({source: this.pathsDetailsSource});

    const map = new Map({
      target: 'hotel_map',
      layers: [new TileLayer({source: new OSM()}), clustersLayer, pathsLayer],
      interactions: defaultInteractions().extend([
        pathSelect,
        clusterSelect,
      ]),
      view: new View({
        center: olProj.fromLonLat([4.832, 45.758]),
        zoom: 15
      }),
      controls: [
        new Zoom(),
        new MyControl(draw),
      ],
    });

    pathSelect.on('select', (selectionEvent) => {
      const features = selectionEvent.target.getFeatures();
      const localModify = new Modify({features});
      map.addInteraction(localModify);
      map.addInteraction(snap);
      localModify.on('modifyend', () => {
        features.forEach(feature => {
          this.removeDuplicates(feature);
        });
      });
      localModify.on('error', e => {
        console.log('Erreur: ' + JSON.stringify(e));
      });
    });
  }

  private addLine(longStart: number, latStart: number, longEnd: number, latEnd: number) {
    const distance = Math.round(sphere.getDistance([longStart, latStart], [longEnd, latEnd]) / 1000);
    const line = new GeoJSON({featureProjection: 'EPSG:3857'}).readFeature(
      {type: 'Feature', geometry: {type: 'LineString', coordinates: [[longStart, latStart], [longEnd, latEnd]]}}
    );
    const center = new GeoJSON({featureProjection: 'EPSG:3857'}).readFeature(
      {
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [(longStart + longEnd) / 2, (latStart + latEnd) / 2]},
        properties: {length: distance}
      }
    );
    this.pathsDetailsSource.addFeature(line);
    this.pathsCentersSource.addFeature(center);
    // this.totalPathsDistance = this.totalPathsDistance + distance;
    // extend(this.totalExtent, line.getGeometry().getExtent());
  }

  // From https://openlayers.org/en/latest/examples/earthquake-clusters.html
  private getClusterStyle(clusterFeature: Feature, resolution: number): Style {
    const featuresOfCluster: Feature[] = clusterFeature.get('features');
    let distance = 0;
    const clusterExtent: Extent = createEmpty();
    featuresOfCluster.forEach(feature => {
      distance = distance + feature.getProperties().length;
      extend(clusterExtent, feature.getGeometry().getExtent());
    });
    // const radius = Math.min(
    //   this.clusterSpacing / 2,
    //   Math.max(10,
    //     Math.sqrt(Math.pow(getWidth(clusterExtent), 2) + Math.pow(getHeight(clusterExtent), 2)) / 2 / resolution));
    const radius = this.clusterSpacing / 2;
    // const clusterDensity = distance / getArea(clusterExtent);
    // const clusterRelativeDensity = clusterDensity / this.averagePathsDensity;

    return new Style({
      image: new CircleStyle({
        radius,
        // fill: new Fill({color: [255, 121, 0, 0.2 + 0.8 * Math.min(clusterRelativeDensity / 5, 1)]}),
        fill: new Fill({color: '#ff7900b0'}),
      }),
      text: new Text({
        text: `${distance}km`,
        scale: 1.5,
        fill: new Fill({color: '#000000'}),
      }),
    });
  }

  private selectStyleFunction(clusterFeature) {
    const styles = [
      new Style({
        image: new CircleStyle({
          radius: this.clusterSpacing / 2,
          fill: new Fill({color: '#ffffff00'})
        }),
      })];
    for (const originalFeature of clusterFeature.get('features')) {
      styles.push(this.createPathPinStyle(originalFeature));
    }
    return styles;
  }

  private createPathPinStyle(feature) {
    return new Style({
      geometry: feature.getGeometry(),
      image: new CircleStyle({
        radius: 5, fill: new Fill({color: '#ff7900'}),
      }),
      fill: new Fill({color: '#ff7900'}),
      stroke: new Stroke({color: '#ff0000'}),
    });
  }

  private removeDuplicates(feature: Feature) {
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
