// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
import * as functions from 'firebase-functions';
import {EventContext} from 'firebase-functions/lib/cloud-functions';
import {QueryDocumentSnapshot} from 'firebase-functions/lib/providers/firestore';

// The Firebase Admin SDK to access Cloud Firestore.
const admin = require('firebase-admin');
admin.initializeApp();

export const setPathCenterCreation = functions.firestore.document('/items/{documentId}')
  .onCreate(computeCenters);

export const setPathCenterUpdate = functions.firestore.document('/items/{documentId}')
  .onUpdate((change, context) => computeCenters(change.after, context));

function computeCenters(doc: QueryDocumentSnapshot, context: EventContext) {
  if (doc.data() == null) {
    functions.logger.log('null data');
    return null;
  }
  if (doc.data().geometry.type !== 'LineString') {
    functions.logger.log('geometry.type !== \'LineString\'');
    return null;
  }

  // Nested array are not supported in Cloud Firestore (yet?)
  // so 'coordinates' is stored as a dict and we change it back
  // to an array
  const lineCoords: number[][] = Object.values(doc.data().geometry.coordinates);
  let lastX = lineCoords[0][0];
  let lastY = lineCoords[0][1];
  let boundingBoxMinX = lastX;
  let boundingBoxMaxX = lastX;
  let boundingBoxMinY = lastY;
  let boundingBoxMaxY = lastY;
  let distance = 0;
  lineCoords.splice(0, 1);

  for (const coord of lineCoords) {
    const coordX = coord[0];
    const coordY = coord[1];
    distance = distance + computeDistance(lastX, lastY, coordX, coordY);
    if (coordX < boundingBoxMinX) {
      boundingBoxMinX = coordX;
    }
    if (coordX > boundingBoxMaxX) {
      boundingBoxMaxX = coordX;
    }
    if (coordY < boundingBoxMinY) {
      boundingBoxMinY = coordY;
    }
    if (coordY > boundingBoxMaxY) {
      boundingBoxMaxY = coordY;
    }
    lastX = coordX;
    lastY = coordY;
  }

  const center = {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [(boundingBoxMinX + boundingBoxMaxX) / 2, (boundingBoxMinY + boundingBoxMaxY) / 2]},
    properties: {distance: Math.round(distance / 100) / 10}
  };
  functions.logger.log(`new center for ${context.params.documentId}: ${JSON.stringify(center)}`);
  return admin.firestore().collection('centers').doc(context.params.documentId).set(center);
}

function toRadians(value: number) {
  return value * Math.PI / 180;
}

function computeDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  // See http://www.movable-type.co.uk/scripts/latlong.html
  const R = 6371e3;
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const λ1 = toRadians(lon1);
  const λ2 = toRadians(lon2);
  const Δφ = φ2 - φ1;
  const Δλ = λ2 - λ1;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

