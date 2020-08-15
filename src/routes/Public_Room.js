import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import styled from "styled-components";
import { WritableStream ,ReadableStream } from 'web-streams-polyfill/ponyfill';
import streamSaver from "streamsaver";
import {down} from '../util/downloader';
import {getip} from '../util/getip';
import {AvatarGen} from '../util/randomAvatarGen';
import QRCode from '../components/qrcode/index';
import Filedropper from '../components/filedropper/index';
import PrivateContainer from '../components/privateContainer/index';
import FileModal from '../components/filemodal/index';
import Avatar from '../components/avatarMain/index';
import './style.css';
import { v1 as uuid } from "uuid";
import Footer from '../components/footer/index'
import SocialButton from '../components/SocialSharingPublic/index';


const worker = new Worker("../worker.js");

const PublicRoom = (props) => {
    const [peers, setPeers] = useState([]);
    const [connectionEstablished, setConnection] = useState(false);
    const [file, setFile] = useState();
    const [gotFile, setGotFile] = useState(false);
    const [isloading, setIsloading] = useState(1);
    const [maxLoad, setMaxLoad] = useState(0);
    const [hostName, setHostName] = useState(0);
    const [position, setPosition] = useState(0);
    const [userNames, setUserNames] = useState([]);
    const [btnWait, setBtnWait] = useState(false);
    const [confirmSend, setConfirmSend] = useState(false);
    const [load, setLoad] = useState(false);
    const [receiver, setReceiver] = useState(false);
    const [pubIp , setPubIp] = useState("")
    const [currentURL , setCurrentURL] = useState("")
    const [users , setUsers] = useState([]);
    const chunksRef = useRef([]);
    const socketRef = useRef();
    const peersRef = useRef([]);
    const peerRef = useRef([]);
    const inRoomUsers = useRef([]);
    const fileNameRef = useRef("");
    const pendingOp = useRef("");
    let count = 0;
    let flag = false
    let guestPeers
    

    useEffect( ()=>{
        (async () => {
        if (!window.WritableStream) {
            streamSaver.WritableStream = WritableStream;
        }
        setCurrentURL(window.location.href)
        socketRef.current = io("https://p2p-dev.herokuapp.com/");
        // socketRef.current = io("http://192.168.0.103:8000/");       //This is the socketIo server

        //This statement is used if the user is on the public route
            getip(setPubIp,socketRef.current)
           
            socketRef.current.on("all users", users => {
                const peers = [];
                users.usersInThisRoom.forEach((userID) => {
                    const peer = createPeer(userID, socketRef.current.id);
                    peersRef.current.push({
                        peerID: userID,
                        peer,
                    })
                    peers.push(peer);
                })
                if(!flag){
                    setHostName(users.usersNamesInThisRoom[users.usersNamesInThisRoom.length-1])
                    flag = true;
                }
                setPeers(peers);
                guestPeers =  peersRef.current;
            })

            socketRef.current.on("usernames", users => {
               setUserNames(users)
               inRoomUsers.current = users
               if(!flag){
                   setHostName(users[users.length-1])
                   flag = true
               }
            })
            socketRef.current.on("user joined", payload => {
                const peer = addPeer(payload.signal, payload.callerID);
                peersRef.current.push({
                    peerID: payload.callerID,
                    peer,
                })
                setPeers(users => [...users, peer]);
        });

        socketRef.current.on("receiving returned signal", payload => {
            const item = peersRef.current.find(p => p.peerID === payload.id);
            item.peer.signal(payload.signal);
            setConnection(true);
        });
        
        //calling Download service worker
        worker.addEventListener("message", (e)=>down(e,fileNameRef.current,peerRef.current));

        socketRef.current.on("room full", () => {
            alert("room is full");
        })

        socketRef.current.on("user left", (data) => {
            handleLeaving()
        });
    })()
    }, []);
    
    function handleLeaving (){
        if(inRoomUsers.current.length<2){
        if(pendingOp.current){
                    window.location.reload(false)
        }                   
            setConnection(false);
            setReceiver(false)
            setGotFile(false);
        }
        worker.postMessage("abort");
    }

    function createPeer(userToSignal, callerID) {
        const peer = new Peer({
            initiator: true,
            trickle: false,
        });

        //handling guest avatar creating logic here
        peer.on("signal", signal => {
            socketRef.current.emit("sending signal", { userToSignal, callerID, signal});
        });
        peer.on("data",(e)=>{handleReceivingData(e)});
        return peer;
    }
    
    function addPeer(incomingSignal, callerID) {
        const peer = new Peer({
            initiator: false,
            trickle: false,
        });

        //handling host avatar creating logic here
        peer.on("signal", signal => {
            socketRef.current.emit("returning signal", { signal, callerID});
        });

        peer.on("data",(e)=>{handleReceivingData(e)});
        peer.signal(incomingSignal);
        setConnection(true);
        return peer;
    }
    function handleReceivingData(data) {
        let parsed
        parsed = JSON.parse(data);
        let dataString = data.toString()
        switch (true) {
            case dataString.includes("maxProgress"):
                parsed = JSON.parse(data);
                setMaxLoad(parsed.maxProgress)                 
                break;
            case dataString.includes("load"):
                setLoad(false)
                setBtnWait(true)                
                break;
            case dataString.includes("wait"):
                setBtnWait(false);             
                break;           
            case dataString.includes("done"):
                setGotFile(true);
                setReceiver(false);
                parsed = JSON.parse(data);
                peersRef.current.forEach(item =>item.peer.write(JSON.stringify({load:true})));              
                pendingOp.current = false  ;
                count = 0;
                setIsloading(0)
                fileNameRef.current = parsed.fileName;            
                break;        
            default: 
                setIsloading(count=>count+1)
                setReceiver(true)
                worker.postMessage(data);
        }        
    }




    function download() {
        setGotFile(false);
        worker.postMessage("download");
    }

    function downloadAbort() {
        setGotFile(false);
        pendingOp.current = false;
        count = 0;
        setIsloading(0)
        worker.postMessage("abort");
        peersRef.current.forEach(item =>item.peer.write(JSON.stringify({ wait:true})));
    }

    function sendConfirm (ans){
        if(ans){
            sendFile(file)
            setConfirmSend(false)
        } else{
            setConfirmSend(false)
        }
    }

    function sendFile(file) {
        const peer = peersRef.current;
        const stream = file.stream();
        const reader = stream.getReader();
        setMaxLoad(Math.floor(file.size/65536))
        peersRef.current.forEach(item =>item.peer.write(JSON.stringify({ maxProgress:file.size/65536})))
        pendingOp.current = true
        setLoad(true)
        reader.read().then(obj => {
            handlereading(obj.done, obj.value);
        });
        
        function handlereading(done, value) {
            if (done) {
                peersRef.current.forEach(item =>item.peer.write(JSON.stringify({ done: true, fileName: file.name})));
                count = 0;
                return;
            }
            
            setIsloading(count=>count+1)
            peersRef.current.forEach(item => item.peer.write(value));
            reader.read().then(obj => {
                handlereading(obj.done, obj.value);
            })
        }
        

    }

    function fileCallback(file){
        setFile(file);
        setConfirmSend(true)
    }


//TODO code splitting components

   
    return (
        <>
                <main>
                  <div className="dropper">
                            <Filedropper 
                            connectionEstablished={connectionEstablished} 
                            fileCallback={fileCallback} 
                            wait={btnWait} 
                            setBtnWait={setBtnWait}
                            isloading={isloading} 
                            receiver={receiver}
                            setLoad={setLoad}
                            confirmSend={confirmSend}
                            sendConfirm={sendConfirm}
                            maxLoad={maxLoad}
                            load={load}
                            position = {hostName}
                            users = {userNames}
                            sendFile={sendFile} />  
                            {gotFile?<FileModal openModal={gotFile} handleAbort={downloadAbort} handleDownload={download} />:null}
                  </div>
                  <div className="public-info share-info ">
                    <div className = "userInfo">
                        <Avatar index={hostName} >
                            <p>You</p>
                        </Avatar>

                    </div>
                    <div className = "qrCont">
                        <PrivateContainer {...props}/>       
                    </div>
                    <div className = "sharingCont">
                    <SocialButton/>
                    </div>
                  </div>
                  <div className="footer">
                    <Footer></Footer>
                  </div>
                </main>

        </>
    );
};

export default PublicRoom;
