// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import DocumentReference = admin.firestore.DocumentReference;

// The Firebase Admin SDK to access Cloud Firestore.
admin.initializeApp();

const runtimeOpts = {
  timeoutSeconds: 300
};

export const initRandom = functions.runWith(runtimeOpts).https.onRequest(async (req, res) => {
  // bellecour
  // admin.firestore().collection('items').add(
  //   {type: 'Feature', geometry: {type: 'Point', coordinates: [4.832, 45.758]}}
  // );
  // quais de rhône
  await addLine(4.841, 45.759, 4.8415, 45.765);
  // france
  await addRandomLines(100, 0.05, -1.4, 7.7, 43.4, 48.9);
  // lyon
  await addRandomLines(25, 0.005, 4.78, 4.95, 45.70, 45.82);
  // paris
  await addRandomLines(25, 0.005, 2.24, 2.41, 48.83, 48.89);

  res.json({res: 'Ayé'});
});

async function addRandomLines(numOfLines: number, maxDist: number, longMin: number, longMax: number, latMin: number, latMax: number) {
  for (let i = 1; i < numOfLines; i++) {
    const longStart = longMin + Math.random() * (longMax - longMin);
    const latStart = latMin + Math.random() * (latMax - latMin);
    const longEnd = longStart + maxDist * (Math.random() - 0.5);
    const latEnd = latStart + maxDist * (Math.random() - 0.5);
    await addLine(longStart, latStart, longEnd, latEnd);
  }
}

async function addLine(longStart: number, latStart: number, longEnd: number, latEnd: number) {
  const pathFeature = {
    type: 'Feature',
    // Nested arrays are not supported in Cloud Firestore (yet?)
    // so 'coordinates' is stored as a dict
    geometry: {type: 'LineString', coordinates: {0: [longStart, latStart], 1: [longEnd, latEnd]}},
    properties: {
      security: 1 + 4 * Math.round(10 * Math.random()) / 10,
      niceness: 1 + 4 * Math.round(10 * Math.random()) / 10,
      creator: 'initScript'
    },
  };
  const centerFeature = getCenter([[longStart, latStart], [longEnd, latEnd]]);
  await admin.firestore().collection('items')
    .add({
        path: pathFeature,
        center: centerFeature
      }
    );
}

export const updateOnNewHistory = functions.firestore.document('/history/{history}/entries/{entry}')
  .onCreate(async (doc) => {
    const itemId = (doc.ref.parent.parent as DocumentReference).id;
    const itemRef = admin.firestore().collection('items').doc(itemId);

    // Nested array are not supported in Cloud Firestore (yet?)
    // so 'coordinates' is stored as a dict and we change it back
    // to an array
    const coordinates: number[][] = Object.values(doc.data().feature.geometry.coordinates);
    const centerFeature = getCenter(coordinates);

    await admin.firestore().runTransaction(async transaction => {
      const itemSnapshot = await transaction.get(itemRef);
      let pathFeature: any;
      const currentItem = itemSnapshot.data();
      if (currentItem !== undefined) {
        // If item exists, only update its geometry
        pathFeature = currentItem.path;
        pathFeature.geometry = doc.data().feature.geometry;
      } else {
        // Otherwise, copy the entire feature from history
        pathFeature = doc.data().feature;
        pathFeature.properties = {creator: doc.data().creator};
      }
      await transaction.set(
        itemRef,
        {
          path: pathFeature,
          center: centerFeature
        });
    });
  });

function getCenter(lineCoords: number[][]) {
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

  return {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [(boundingBoxMinX + boundingBoxMaxX) / 2, (boundingBoxMinY + boundingBoxMaxY) / 2]},
    properties: {distance: Math.round(distance / 100) / 10}
  };
}

function computeDistance(lon1: number, lat1: number, lon2: number, lat2: number) {
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

function toRadians(value: number) {
  return value * Math.PI / 180;
}

export const updateOnNewRating = functions.firestore.document('/ratings/{rating}/entries/{entry}')
  .onCreate((query) => processRating(query));

export const updateOnUpdatedRating = functions.firestore.document('/ratings/{rating}/entries/{entry}')
  .onUpdate((change) => processRating(change.after));

async function processRating(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const itemId = (doc.ref.parent.parent as DocumentReference).id;
  const itemRef = admin.firestore().collection('items').doc(itemId);

  let averageSecurity = 0;
  let averageNiceness = 0;

  const ratingsRefs = await admin.firestore().collection('ratings')
    .doc(itemId)
    .collection('entries')
    .listDocuments();

  for (const ratingRef of ratingsRefs) {
    const rating = await ratingRef.get();
    averageSecurity += (rating.data() as any).security;
    averageNiceness += (rating.data() as any).niceness;
  }
  averageSecurity = Math.round(10 * averageSecurity / ratingsRefs.length) / 10;
  averageNiceness = Math.round(10 * averageNiceness / ratingsRefs.length) / 10;

  await admin.firestore().runTransaction(async transaction => {
    const itemSnapshot = await transaction.get(itemRef);
    let feature: any;
    const currentItem = itemSnapshot.data();
    if (currentItem !== undefined) {
      // If item exists, only update its ratings
      feature = currentItem;
      feature.path.properties.security = averageSecurity;
      feature.path.properties.niceness = averageNiceness;
    } else {
      // Otherwise, create only the ratings,
      // the path geometry and center will be updated later by updateOnNewHistory
      feature = {
        path:
          {
            properties: {security: averageSecurity, niceness: averageNiceness, creator: doc.ref.id},
            type: 'Feature'
          }
      };
    }
    await transaction.set(itemRef, feature);
  });
}
