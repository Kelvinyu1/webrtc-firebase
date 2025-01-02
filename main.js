import "./style.css";

import firebase from "firebase/app";
import "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_DATABASE_URL,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID,
  measurementId: import.meta.env.VITE_MEASUREMENT_ID,
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

const servers = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
const pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;

// HTML elements
const webcamButton = document.getElementById("webcamButton");
const webcamVideo = document.getElementById("webcamVideo");
const callButton = document.getElementById("callButton");
const callInput = document.getElementById("callInput");
const answerButton = document.getElementById("answerButton");
const remoteVideo = document.getElementById("remoteVideo");
const hangupButton = document.getElementById("hangupButton");

// 1. Setup media sources
webcamButton.onclick = async () => {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  remoteStream = new MediaStream();

  // Add only non-audio tracks to the peer connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Pull tracks from remote stream, add to video stream
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      console.log("Adding remote audio track:", track);
      remoteStream.addTrack(track); // Add only remote audio tracks
    });
    remoteVideo.srcObject = remoteStream;
  };

  webcamVideo.srcObject = localStream;
  webcamVideo.muted = true; // Mute local video playback

  remoteVideo.volume = 1.0; // Ensure remote audio is audible
  remoteVideo.muted = false;

  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;
};

// 2. Create an offer
callButton.onclick = async () => {
  // Reference Firestore collections for signaling
  const callDoc = firestore.collection("calls").doc();
  const offerCandidates = callDoc.collection("offerCandidates");
  const answerCandidates = callDoc.collection("answerCandidates");

  callInput.value = callDoc.id;

  // Get candidates for caller, save to db
  pc.onicecandidate = (event) => {
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  };

  // Create offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await callDoc.set({ offer });

  // Listen for remote answer
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  // When answered, add candidate to peer connection
  answerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });

  hangupButton.disabled = false;
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value;
  const callDoc = firestore.collection("calls").doc(callId);
  const answerCandidates = callDoc.collection("answerCandidates");
  const offerCandidates = callDoc.collection("offerCandidates");

  pc.onicecandidate = (event) => {
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();

  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await callDoc.update({ answer });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      console.log(change);
      if (change.type === "added") {
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
};

// 4. Hang up and clean up Firestore data
hangupButton.onclick = async () => {
  // Get the call ID from the input field
  const callId = callInput.value;

  if (!callId) {
    console.error("No call ID found to hang up.");
    return;
  }

  // Reference the call document and its subcollections
  const callDoc = firestore.collection("calls").doc(callId);
  const offerCandidates = callDoc.collection("offerCandidates");
  const answerCandidates = callDoc.collection("answerCandidates");

  // Delete offerCandidates
  const offerSnapshots = await offerCandidates.get();
  offerSnapshots.forEach(async (doc) => {
    await doc.ref.delete();
  });

  // Delete answerCandidates
  const answerSnapshots = await answerCandidates.get();
  answerSnapshots.forEach(async (doc) => {
    await doc.ref.delete();
  });

  // Finally, delete the call document
  await callDoc.delete();

  // Close peer connection
  pc.close();

  // Reset UI state (if needed)
  hangupButton.disabled = true;
  callButton.disabled = true;
  answerButton.disabled = true;
  webcamButton.disabled = false;

  console.log("Call ended and data deleted.");
};

document.addEventListener("DOMContentLoaded", () => {
  // Your existing code that sets up WebRTC functionality

  // Add the control panel for the local stream
  const localVideo = document.getElementById("webcamVideo");

  // Create the control panel
  const controlDiv = document.createElement("div");
  controlDiv.style.position = "absolute";
  controlDiv.style.bottom = "10px";
  controlDiv.style.left = "10px";
  controlDiv.style.background = "rgba(0, 0, 0, 0.5)";
  controlDiv.style.color = "#fff";
  controlDiv.style.padding = "10px";
  controlDiv.style.borderRadius = "5px";
  controlDiv.style.display = "flex";
  controlDiv.style.gap = "10px";

  // Create mute button
  const muteButton = document.createElement("button");
  muteButton.textContent = "Mute";
  muteButton.style.cursor = "pointer";

  // Create toggle video button
  const videoButton = document.createElement("button");
  videoButton.textContent = "Hide Video";
  videoButton.style.cursor = "pointer";

  // Attach event listeners
  muteButton.addEventListener("click", () => {
    const stream = localVideo.srcObject;
    const audioTrack = stream?.getAudioTracks()[0]; // Get the audio track
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled; // Enable/Disable the audio track
      muteButton.textContent = audioTrack.enabled ? "Mute" : "Unmute";
    }
    localVideo.muted = true;
  });

  // Prevent local audio playback

  videoButton.addEventListener("click", () => {
    const stream = localVideo.srcObject;
    const videoTrack = stream?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      videoButton.textContent = videoTrack.enabled
        ? "Hide Video"
        : "Show Video";
    }
  });

  // Append buttons to the control panel
  controlDiv.appendChild(muteButton);
  controlDiv.appendChild(videoButton);

  // Add the control panel to the local video container
  localVideo.parentElement.appendChild(controlDiv);
});
