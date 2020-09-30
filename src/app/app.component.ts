import {Component, OnInit} from '@angular/core';
import {getCenter} from 'ol/extent';
import GeoJSON from 'ol/format/GeoJSON';
import Feature from 'ol/Feature';
import Map from 'ol/Map';
import View from 'ol/View';
import GeometryType from 'ol/geom/GeometryType';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import * as sphere from 'ol/sphere';
import {Control, ScaleLine, defaults as defaultControls} from 'ol/control';
import {Draw, Modify, Select, Snap, defaults as defaultInteractions} from 'ol/interaction';
import {OSM} from 'ol/source';
import VectorSource, {VectorSourceEvent} from 'ol/source/Vector';
import * as olProj from 'ol/proj';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import {Circle as CircleStyle, Fill, Stroke, Style, Text} from 'ol/style';
import {AngularFirestore} from '@angular/fire/firestore';
import {DocumentChangeAction} from '@angular/fire/firestore/interfaces';
import {SelectEvent} from 'ol/interaction/Select';
import {DrawEvent} from 'ol/interaction/Draw';
import {ModifyEvent} from 'ol/interaction/Modify';
import Geometry from 'ol/geom/Geometry';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})

export class AppComponent implements OnInit {
  title = 'open-bike-map';
  private pathsDetailsSource = new VectorSource();
  private pathsCentersSource = new VectorSource();
  private readonly countryThresholdZoom = 6;
  private readonly regionThresholdZoom = 8;
  private readonly departmentThresholdZoom = 10;
  private totalPathsDistance: number;
  private readonly numberOfDepartments = 102;
  private readonly numberOfRegions = 19;
  private averagePathDensityPerRegion: number;
  private averagePathDensityPerDepartment: number;
  private readonly areaBorderStyle = new Style({stroke: new Stroke({color: '#ff7900', width: 2})});
  private firestore: AngularFirestore;

  constructor(firestore: AngularFirestore) {
    this.firestore = firestore;
  }

  ngOnInit() {
    this.firestore.collection('items').stateChanges()
      .subscribe(
        (items: DocumentChangeAction<any>[]) => {
          this.removeFeatures(items.filter(item => item.payload.type === 'removed'));

          const addedItems = items.filter(item => item.payload.type === 'added');
          if (addedItems.length > 0) {
            this.pathsDetailsSource.addFeatures(
              new GeoJSON({featureProjection: 'EPSG:3857'})
                .readFeatures(this.getFeaturesCollection(addedItems)));
          }

          const modifiedItems = items.filter(item => item.payload.type === 'modified');
          if (modifiedItems.length > 0) {
            this.removeFeatures(modifiedItems);
            this.pathsDetailsSource.addFeatures(
              new GeoJSON({featureProjection: 'EPSG:3857'})
                .readFeatures(this.getFeaturesCollection(modifiedItems)));
          }
        }
      );

    this.firestore.collection('centers').valueChanges()
      .subscribe(
        (items: any) => {
          const featuresCollection = {type: 'FeatureCollection', features: items};
          this.pathsCentersSource.clear();
          this.pathsCentersSource.addFeatures(
            new GeoJSON({featureProjection: 'EPSG:3857'})
              .readFeatures(featuresCollection));
        }
      );

    const countrySource = new VectorSource({url: 'assets/country.geojson', format: new GeoJSON()});
    const countryLayer = new VectorLayer({
      source: countrySource,
      maxZoom: this.countryThresholdZoom,
      style: (feature: Feature, resolution: number) => this.getAreaStyle(feature, null),
    });

    const regionSource = new VectorSource({url: 'assets/regions.geojson', format: new GeoJSON()});
    const regionsLayer = new VectorLayer({
      source: regionSource,
      minZoom: this.countryThresholdZoom,
      maxZoom: this.regionThresholdZoom,
      style: (feature: Feature, resolution: number) => this.getAreaStyle(feature, this.averagePathDensityPerRegion),
    });

    const departmentsSource = new VectorSource({url: 'assets/departments.geojson', format: new GeoJSON()});
    const departmentsLayer = new VectorLayer({
      source: departmentsSource,
      minZoom: this.regionThresholdZoom,
      maxZoom: this.departmentThresholdZoom,
      style: (feature: Feature, resolution: number) => this.getAreaStyle(feature, this.averagePathDensityPerDepartment),
    });

    const pathsLayer = new VectorLayer({
      source: this.pathsDetailsSource,
      minZoom: this.departmentThresholdZoom,
      style: new Style({
        stroke: new Stroke({color: '#ff7900', width: 6}),
        image: new CircleStyle({
          radius: 10, fill: new Fill({color: '#ff0000'}),
        })
      }),
    });

    const pathSelect = new Select({layers: [pathsLayer]});
    const modify = new Modify({features: pathSelect.getFeatures()});
    const areaSelect = new Select({
      layers: [countryLayer, regionsLayer, departmentsLayer],
      condition: (evt => evt.type === 'singleclick'),
      style: (areaFeature: Feature) => this.getSelectAreaStyle(areaFeature),
    });
    const draw = new Draw({source: this.pathsDetailsSource, type: GeometryType.LINE_STRING});
    const snap = new Snap({source: this.pathsDetailsSource});

    const bikeMap = new Map({
      target: 'bike_map',
      layers: [
        new TileLayer({source: new OSM()}),
        pathsLayer,
        departmentsLayer,
        regionsLayer,
        countryLayer,
      ],
      interactions: defaultInteractions().extend([
        pathSelect,
        areaSelect,
        modify,
        snap
      ]),
      view: new View({
        center: olProj.fromLonLat([4.832, 45.758]),
        zoom: 15
      }),
      controls: defaultControls().extend([
        new ScaleLine({minWidth: 150}),
        new MyControl(draw),
      ])
    });

    pathSelect.on('select', (selectionEvent: SelectEvent) => {
      selectionEvent.deselected.forEach(feature => {
        const geometry = feature.getGeometry().clone().transform('EPSG:3857', 'EPSG:4326');
        if (geometry.getType() === 'LineString' && feature.getProperties().modified) {
          feature.getProperties().modified = false;
          const coordinates = (geometry as LineString).getCoordinates();
          this.firestore.collection('items').doc(feature.getProperties().firestoreId)
            .update(
              {
                // Nested array are not supported in Cloud Firestore (yet?)
                // so 'coordinates' is stored as a dict
                geometry: {type: 'LineString', coordinates: Object.assign({}, coordinates)}// https://stackoverflow.com/a/36388401
              }
            );
        }
      });
    });

    modify.on('modifyend', (modifyEvent: ModifyEvent) => {
      modifyEvent.features.forEach(feature => {
        feature.setProperties({modified: true});
        this.removeDuplicates(feature);
      });
    });

    draw.on('drawend', (drawEvent: DrawEvent) => {
        const geometry = drawEvent.feature.getGeometry().clone().transform('EPSG:3857', 'EPSG:4326');
        const coordinates = (geometry as LineString).getCoordinates();
        this.firestore.collection('items')
          .add(
            {
              type: 'Feature',
              // Nested array are not supported in Cloud Firestore (yet?)
              // so 'coordinates' is stored as a dict
              geometry: {type: 'LineString', coordinates: Object.assign({}, coordinates)}// https://stackoverflow.com/a/36388401
            }
          );
      }
    );

    // Immediately remove added features if they were added by "draw" interaction (not Firestore)
    this.pathsDetailsSource.on('addfeature', (vectorSourceEvent: VectorSourceEvent) => {
      if (!vectorSourceEvent.feature.getProperties().addedByFirestore) {
        this.pathsDetailsSource.removeFeature(vectorSourceEvent.feature);
      }
    });
  }

  private removeFeatures(items: DocumentChangeAction<any>[]) {
    items.forEach(item => {
      const featureToRemove = this.pathsDetailsSource.getFeatures()
        .filter(feature => feature.getProperties().firestoreId === item.payload.doc.id);
      if (featureToRemove.length === 1) {
        this.pathsDetailsSource.removeFeature(featureToRemove[0]);
      }
    });
  }

  private getFeaturesCollection(items: DocumentChangeAction<any>[]) {
    return {
      type: 'FeatureCollection',
      features: items.map((item: DocumentChangeAction<any>) => {
        const feature = item.payload.doc.data();
        if (feature.properties === undefined) {
          feature.properties = {};
        }
        feature.properties.firestoreId = item.payload.doc.id;
        feature.properties.addedByFirestore = true;
        // Nested array are not supported in Cloud Firestore (yet?)
        // so 'coordinates' is stored as a dict and we change it back
        // to an array
        feature.geometry.coordinates = Object.values(feature.geometry.coordinates);
        return feature;
      })
    };
  }

  clearMap() {
    this.firestore.collection('items').get().subscribe(res => {
      res.forEach(element => {
        element.ref.delete();
      });
    });

    this.firestore.collection('centers').get().subscribe(res => {
      res.forEach(element => {
        element.ref.delete();
      });
    });
  }

  initMap() {
    this.totalPathsDistance = 0;

    // bellecour
    this.firestore.collection('items').add(
      {type: 'Feature', geometry: {type: 'Point', coordinates: [4.832, 45.758]}}
    );
    // quais de rhône
    this.addLine(4.841, 45.759, 4.8415, 45.765);

    /*
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
    */

    this.averagePathDensityPerRegion = this.totalPathsDistance / this.numberOfRegions;
    this.averagePathDensityPerDepartment = this.totalPathsDistance / this.numberOfDepartments;
  }

  private addLine(longStart: number, latStart: number, longEnd: number, latEnd: number) {
    const distance = Math.round(sphere.getDistance([longStart, latStart], [longEnd, latEnd]) / 100) / 10;
    this.firestore.collection('items')
      .add(
        {
          type: 'Feature',
          // Nested array are not supported in Cloud Firestore (yet?)
          // so 'coordinates' is stored as a dict
          geometry: {type: 'LineString', coordinates: {0: [longStart, latStart], 1: [longEnd, latEnd]}}
        }
      );
    this.totalPathsDistance = this.totalPathsDistance + distance;
  }

  private getAreaStyle(areaFeature: Feature, averageDensity: number): Style[] {
    const distance = this.pathsCentersSource.getFeatures()
      .filter(pathFeature => areaFeature.getGeometry().intersectsCoordinate((pathFeature.getGeometry() as Point).getCoordinates()))
      .map(pathFeature => pathFeature.getProperties().distance)
      .reduce((acc, curr) => acc + curr, 0);
    let circleFill: Fill;
    if (averageDensity == null) {
      circleFill = new Fill({color: '#ff7900'});
    } else {
      const opacity = 0.2 + 0.8 * Math.min(distance / averageDensity / 2, 1);
      circleFill = new Fill({color: [255, 7 * 16 + 9, 0, opacity]});
    }

    let areaCenter: Geometry;
    if (averageDensity !== null) {
      areaCenter = new Point(getCenter(areaFeature.getGeometry().getExtent()));
    } else {
      // https://fr.wikipedia.org/wiki/Centre_de_la_France
      areaCenter = new Point([2 + (25 + 0 / 60) / 60 , 46 + (45 + 7 / 60) / 60])
        .transform('EPSG:4326', 'EPSG:3857');
    }

    return [
      this.areaBorderStyle,
      new Style({
        geometry: areaCenter,
        image: new CircleStyle({
          radius: 40,
          fill: circleFill,
        }),
        text: new Text({
          text: `${Math.round(distance)}km`,
          scale: 2,
          fill: new Fill({color: '#ffffff'}),
        }),
      })];
  }

  private getSelectAreaStyle(areaFeature) {
    const styles = [this.areaBorderStyle];
    const pathCenters = this.pathsCentersSource.getFeatures()
      .filter(pathFeature => areaFeature.getGeometry().intersectsCoordinate((pathFeature.getGeometry() as Point).getCoordinates()));
    for (const pathCenterFeature of pathCenters) {
      styles.push(this.getPathPinStyle(pathCenterFeature));
    }
    return styles;
  }

  private getPathPinStyle(feature) {
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
    button.innerHTML = 'A';
    const element = document.createElement('div');
    element.className = 'ol-custom ol-unselectable ol-control';
    element.appendChild(button);
    button.addEventListener('click', () => {
      if (drawEnabled) {
        (this as Control).getMap().removeInteraction(draw);
        button.innerHTML = 'Activer l\'ajout';
        (this as Control).getMap().removeInteraction(draw);
        button.innerHTML = 'A';
      } else {
        (this as Control).getMap().addInteraction(draw);
        button.innerHTML = 'Désactiver l\'ajout';
        (this as Control).getMap().addInteraction(draw);
        button.innerHTML = 'M';
      }
      drawEnabled = !drawEnabled;
    });
    super({element});
  }
}
