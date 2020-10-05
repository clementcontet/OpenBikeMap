import {environment} from '../environments/environment';
import {Component, OnInit} from '@angular/core';
import {AngularFirestore} from '@angular/fire/firestore';
import {AngularFireAuth} from '@angular/fire/auth';
import {DocumentChangeAction, QueryDocumentSnapshot} from '@angular/fire/firestore/interfaces';
import {MatDialog} from '@angular/material/dialog';
import {User} from 'firebase';
import {ScaleLine, defaults as defaultControls} from 'ol/control';
import {never, primaryAction} from 'ol/events/condition';
import {getCenter} from 'ol/extent';
import Feature from 'ol/Feature';
import GeoJSON from 'ol/format/GeoJSON';
import Geometry from 'ol/geom/Geometry';
import GeometryType from 'ol/geom/GeometryType';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import {Draw, Modify, Select, Snap, defaults as defaultInteractions} from 'ol/interaction';
import {DrawEvent} from 'ol/interaction/Draw';
import {ModifyEvent} from 'ol/interaction/Modify';
import {SelectEvent} from 'ol/interaction/Select';
import Heatmap from 'ol/layer/Heatmap';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import Map from 'ol/Map';
import * as olProj from 'ol/proj';
import View from 'ol/View';
import {OSM} from 'ol/source';
import VectorSource from 'ol/source/Vector';
import * as sphere from 'ol/sphere';
import {Circle as CircleStyle, Fill, Stroke, Style, Text} from 'ol/style';
import {LoginDialogComponent} from './login-dialog/login-dialog.component';
import {PopupDialogComponent} from './popup-dialog/popup-dialog.component';

enum InteractionState {
  Browsing,
  Drawing,
  Creating,
  Consulting,
  Modifying
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})

export class AppComponent implements OnInit {
  title = 'open-bike-map';
  InteractionState = InteractionState;
  interactionState = InteractionState.Browsing;
  selectedPathDistance = null;
  private bikeMap: Map;
  private draw: Draw;
  private select: Select;
  private modify: Modify;
  private pathsDetailsSource = new VectorSource();
  private pathsCentersSource = new VectorSource();
  private countryLayer: VectorLayer;
  private regionsLayer: VectorLayer;
  private departmentsLayer: VectorLayer;
  private readonly countryThresholdZoom = 6;
  private readonly regionThresholdZoom = 8;
  private readonly departmentThresholdZoom = 10;
  private readonly areaBorderStyle = new Style({stroke: new Stroke({color: '#333'})});
  private readonly firestore: AngularFirestore;
  private readonly fireAuth: AngularFireAuth;
  user: User;
  private readonly dialog: MatDialog;
  private readonly geoJson = new GeoJSON({featureProjection: 'EPSG:3857'});

  featureSelected() {
    return this.interactionState === InteractionState.Creating
      || this.interactionState === InteractionState.Consulting
      || this.interactionState === InteractionState.Modifying;
  }

  constructor(firestore: AngularFirestore, fireAuth: AngularFireAuth, dialog: MatDialog) {
    this.firestore = firestore;
    this.fireAuth = fireAuth;
    this.dialog = dialog;
  }

  ngOnInit() {
    this.subscribeToFirestoreModifications();
    this.createMap();
    this.listenToEvents();
    this.updateInteractions();
    this.fireAuth.user.subscribe(user => {
      this.user = user;
      this.verifyIfEmailLinkValidationIsNeeded();
    });
  }

  // https://firebase.google.com/docs/auth/web/email-link-auth?hl=en
  private verifyIfEmailLinkValidationIsNeeded() {
    if (!this.user) {
      this.fireAuth.isSignInWithEmailLink(window.location.href)
        .then(isSignInWithEmailLink => {
          if (isSignInWithEmailLink) {
            this.validateEmailLink();
          }
        });
    }
  }

  private validateEmailLink() {
    const email = window.localStorage.getItem('emailForSignIn');
    if (email) {
      this.fireAuth.signInWithEmailLink(email, window.location.href)
        .then((result) => {
          window.localStorage.removeItem('emailForSignIn');
        });
    } else {
      this.dialog.open(PopupDialogComponent, {
        width: '250px',
        data: {
          content: 'Lien invalide sur cet appareil, veuillez recommencer l\'authentification.',
          cancelPossible: false
        }
      });
    }
  }

  login() {
    const dialogRef = this.dialog.open(LoginDialogComponent, {
      width: '250px',
      data: {}
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        const options = {
          // URL you want to redirect back to. The domain (www.example.com) for this
          // URL must be whitelisted in the Firebase Console.
          url: environment.signInEmailLinkDomain,
          // This must be true.
          handleCodeInApp: true
        };
        this.fireAuth.sendSignInLinkToEmail(result, options)
          .then(() => {
            // The link was successfully sent. Inform the user.
            // Save the email locally so you don't need to ask the user for it again
            // if they open the link on the same device.
            window.localStorage.setItem('emailForSignIn', result);
            this.dialog.open(PopupDialogComponent, {
              width: '250px',
              data: {
                content: 'L\'email de connexion a été envoyé.',
                cancelPossible: false
              }
            });
          });
      }
    });
  }

  logout() {
    const dialogRef = this.dialog.open(PopupDialogComponent, {
      width: '250px',
      data: {
        content: 'Voulez-vous vous déconnecter ?',
        cancelPossible: true,
        validate: false
      }
    });

    dialogRef.afterClosed().subscribe(logoutValidated => {
      if (logoutValidated) {
        this.fireAuth.signOut();
      }
    });
  }

  private subscribeToFirestoreModifications() {
    this.firestore.collection('items').stateChanges()
      .subscribe(
        (items: DocumentChangeAction<any>[]) => {
          this.removeFeatures(items.filter(item => item.payload.type === 'removed'));

          const addedItems = items.filter(item => item.payload.type === 'added');
          if (addedItems.length > 0) {
            this.pathsDetailsSource.addFeatures(
              this.geoJson.readFeatures(this.getFeaturesCollection(addedItems)));
          }

          const modifiedItems = items.filter(item => item.payload.type === 'modified');
          if (modifiedItems.length > 0) {
            this.removeFeatures(modifiedItems);
            this.pathsDetailsSource.addFeatures(
              this.geoJson.readFeatures(this.getFeaturesCollection(modifiedItems)));
          }
        }
      );

    this.firestore.collection('centers').valueChanges()
      .subscribe(
        (items: any) => {
          const featuresCollection = {type: 'FeatureCollection', features: items};
          this.pathsCentersSource.clear();
          this.pathsCentersSource.addFeatures(
            this.geoJson.readFeatures(featuresCollection));

          // These three layers sources don't change, but they style should change with the new distance
          this.countryLayer.changed();
          this.regionsLayer.changed();
          this.departmentsLayer.changed();
        }
      );
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
        return this.getFeature(item.payload.doc);
      })
    };
  }

  private getFeature(doc: QueryDocumentSnapshot<any>) {
    const feature = doc.data();
    if (feature.properties === undefined) {
      feature.properties = {};
    }
    feature.properties.firestoreId = doc.id;
    // Nested arrays are not supported in Cloud Firestore (yet?)
    // so 'coordinates' is stored as a dict and we change it back
    // to an array
    feature.geometry.coordinates = Object.values(feature.geometry.coordinates);
    return feature;
  }

  private createMap() {
    const countrySource = new VectorSource({url: 'assets/country.geojson', format: this.geoJson});
    this.countryLayer = new VectorLayer({
      source: countrySource,
      maxZoom: this.countryThresholdZoom,
      style: (feature: Feature, resolution: number) => this.getAreaStyle(feature, true),
    });

    const regionSource = new VectorSource({url: 'assets/regions.geojson', format: this.geoJson});
    this.regionsLayer = new VectorLayer({
      source: regionSource,
      minZoom: this.countryThresholdZoom,
      maxZoom: this.regionThresholdZoom,
      style: (feature: Feature, resolution: number) => this.getAreaStyle(feature, false),
    });

    const departmentsSource = new VectorSource({url: 'assets/departments.geojson', format: this.geoJson});
    this.departmentsLayer = new VectorLayer({
      source: departmentsSource,
      minZoom: this.regionThresholdZoom,
      maxZoom: this.departmentThresholdZoom,
      style: (feature: Feature, resolution: number) => this.getAreaStyle(feature, false),
    });

    const heatLayer = new Heatmap({
      source: this.pathsCentersSource,
      maxZoom: this.departmentThresholdZoom,
      weight: feature => feature.getProperties().distance,
      gradient: ['#fff', '#ff7900']
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

    this.select = new Select({layers: [pathsLayer], toggleCondition: never});
    this.modify = new Modify({features: this.select.getFeatures()});
    this.draw = new Draw({
      source: this.pathsDetailsSource,
      type: GeometryType.LINE_STRING,
      stopClick: true, // avoid zoom by double clicking
      condition: primaryAction, // avoid right click
    });
    const snap = new Snap({source: this.pathsDetailsSource});

    this.bikeMap = new Map({
      target: 'bike_map',
      layers: [
        new TileLayer({source: new OSM()}),
        pathsLayer,
        heatLayer,
        this.departmentsLayer,
        this.regionsLayer,
        this.countryLayer,
      ],
      interactions: defaultInteractions({pinchRotate: false}).extend([
        this.select,
        this.modify,
        this.draw,
        snap
      ]),
      view: new View({
        center: olProj.fromLonLat([4.832, 45.758]),
        zoom: 15
      }),
      controls: defaultControls().extend([new ScaleLine({minWidth: 150})])
    });
  }

  private getAreaStyle(areaFeature: Feature, isFrance: boolean): Style[] {
    const distance = this.pathsCentersSource.getFeatures()
      .filter(pathFeature => areaFeature.getGeometry().intersectsCoordinate((pathFeature.getGeometry() as Point).getCoordinates()))
      .map(pathFeature => pathFeature.getProperties().distance)
      .reduce((acc, curr) => acc + curr, 0);

    let areaCenter: Geometry;
    if (isFrance) {
      // https://fr.wikipedia.org/wiki/Centre_de_la_France
      areaCenter = new Point([2 + (25 + 0 / 60) / 60, 46 + (45 + 7 / 60) / 60])
        .transform('EPSG:4326', 'EPSG:3857');
    } else {
      areaCenter = new Point(getCenter(areaFeature.getGeometry().getExtent()));
    }

    return [
      this.areaBorderStyle,
      new Style({
        geometry: areaCenter,
        text: new Text({
          font: '1.5em bold Helvetica, sans-serif',
          text: `${Math.round(distance)}km`,
          fill: new Fill({color: '#fff'}),
          stroke: new Stroke({color: '#000', width: 4}),
        }),
      })];
  }

  private listenToEvents() {
    this.select.on('select', (selectionEvent: SelectEvent) => {
      this.selectedPathDistance = null;
      if (selectionEvent.selected.length === 1) {
        this.interactionState = InteractionState.Consulting;
      } else {
        this.interactionState = InteractionState.Browsing;
      }
      this.updateInteractions();
    });

    // Simplify lines that have duplicated points
    this.modify.on('modifyend', (modifyEvent: ModifyEvent) => {
      modifyEvent.features.forEach(feature => this.removeDuplicates(feature));
      this.updateInteractions();
    });

    this.draw.on('drawend', (drawEvent: DrawEvent) => {
        if ((drawEvent.feature.getGeometry() as LineString).getLength() > 0) {
          this.interactionState = InteractionState.Creating;
          this.select.getFeatures().insertAt(0, drawEvent.feature);
          this.updateInteractions();
        } else {
          this.interactionState = InteractionState.Browsing;
          this.updateInteractions();
        }
      }
    );

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.interactionState = InteractionState.Browsing;
        this.updateInteractions();
      } else if (e.key === 'Enter') {
        this.draw.finishDrawing();
      }
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

  startDrawing() {
    if (this.user) {
      this.interactionState = InteractionState.Drawing;
      this.updateInteractions();
    } else {
      this.dialog.open(PopupDialogComponent, {
        width: '250px',
        data: {
          content: 'Vous devez vous connecter pour pouvoir créer un nouveau chemin.',
          cancelPossible: false
        }
      });
    }
  }

  cancelDrawing() {
    this.interactionState = InteractionState.Browsing;
    this.updateInteractions();
  }

  startModification() {
    if (this.user) {
      this.interactionState = InteractionState.Modifying;
      this.updateInteractions();
    } else {
      this.dialog.open(PopupDialogComponent, {
        width: '250px',
        data: {
          content: 'Vous devez vous connecter pour pouvoir modifier un chemin.',
          cancelPossible: false
        }
      });
    }
  }

  validateEdition() {
    const feature = this.select.getFeatures().item(0);
    const geometry = feature.getGeometry().transform('EPSG:3857', 'EPSG:4326');
    const coordinates = (geometry as LineString).getCoordinates();
    // Nested arrays are not supported in Cloud Firestore (yet?)
    // so 'coordinates' is stored as a dict (see https://stackoverflow.com/a/36388401)
    const coordinatesMap = Object.assign({}, coordinates);
    if (this.interactionState === InteractionState.Creating) {
      this.pathsDetailsSource.removeFeature(feature);
      this.firestore.collection('items')
        .add({type: 'Feature', geometry: {type: 'LineString', coordinates: coordinatesMap}});
    } else if (this.interactionState === InteractionState.Modifying) {
      if (geometry.getType() === 'LineString') {
        this.firestore.collection('items').doc(feature.getProperties().firestoreId)
          .update({geometry: {type: 'LineString', coordinates: coordinatesMap}});
      }
    }
    this.interactionState = InteractionState.Browsing;
    this.updateInteractions();
  }

  cancelEdition() {
    const feature = this.select.getFeatures().item(0);
    this.pathsDetailsSource.removeFeature(feature);

    if (this.interactionState === InteractionState.Modifying) {
      this.firestore.collection('items').doc(feature.getProperties().firestoreId)
        .get()
        .subscribe(item => {
            this.pathsDetailsSource.addFeature(
              this.geoJson.readFeature(this.getFeature(item))
            );
          }
        );
    }

    this.interactionState = InteractionState.Browsing;
    this.updateInteractions();
  }

  updateInteractions() {
    this.draw.setActive(this.interactionState === InteractionState.Drawing);
    this.select.setActive(this.interactionState === InteractionState.Browsing
      || this.interactionState === InteractionState.Consulting);
    this.modify.setActive(this.interactionState === InteractionState.Modifying);

    if (this.featureSelected()) {
      const feature = this.select.getFeatures().item(0);
      const geometry = feature.getGeometry()
        .clone()
        .transform('EPSG:3857', 'EPSG:4326');
      if (geometry instanceof LineString) {
        this.selectedPathDistance = Math.round(this.computeDistance(geometry) / 100) / 10;
      }
    }

    if (!this.featureSelected()) {
      this.select.getFeatures().clear();
    }
  }

  private computeDistance(geometry: LineString): number {
    const lineCoords: number[][] = geometry.getCoordinates();
    let lastX = lineCoords[0][0];
    let lastY = lineCoords[0][1];
    let distance = 0;
    lineCoords.splice(0, 1);
    for (const coord of lineCoords) {
      const coordX = coord[0];
      const coordY = coord[1];
      distance = distance + sphere.getDistance([lastX, lastY], [coordX, coordY]);
      lastX = coordX;
      lastY = coordY;
    }
    return distance;
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
  }

  private addLine(longStart: number, latStart: number, longEnd: number, latEnd: number) {
    this.firestore.collection('items')
      .add(
        {
          type: 'Feature',
          // Nested arrays are not supported in Cloud Firestore (yet?)
          // so 'coordinates' is stored as a dict
          geometry: {type: 'LineString', coordinates: {0: [longStart, latStart], 1: [longEnd, latEnd]}}
        }
      );
  }
}


