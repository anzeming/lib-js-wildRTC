var ConfigProvider = require('./ConfigProvider').ConfigProvider;
var PeerConnection = require('wild-peerconnection');
var WildStream = require('./WildStream');
var WildData = require('./WildData');
var events = require('events');

var WildRTC = function(ref, callback) {
    this.wildEmitter = new events.EventEmitter();
    var appidString = ref.toString().split('.').shift();
    this.appid = appidString.split("//").pop();
    this.ref = ref;
    this.uid = ref.getAuth().uid;
    this.localStream = null;
    this.isAddStream = false;
    this.hasStreamList = {};
    this.noStreamList = {};
    this.receivePeerList = {};
    this.receiveStreamList = {};
    this.sendPeerConnection = null;
    this.receivePeerConnection = null;
    this.key = Math.random().toString(16).substr(2);
}

module.exports = WildRTC;
if (window)
    window.WildRTC = WildRTC;
WildRTC.prototype.join = function(callback) {
    var configProvider = new ConfigProvider(this.appid, this.ref);
    var wildData = new WildData(this.ref);
    var self = this;
    self.ref.child('keys/' + self.uid).set(this.key, function(err) {
        self.ref.child('keys/' + self.uid).onDisconnect().remove();
        wildData.join(self.uid, function(err) {
            if (err != null) {
                callback(err);
            } else {
                configProvider.getConfig(function(configuration) {
                    wildData.onUserAdd(self.uid, function(remoteId) {
                        console.log('new user join ,uid:' + remoteId);
                        wildData.onceKey(remoteId, function(remotekey) {
                            var localSendRef = self.ref.child('users/' + self.uid + '/send/' + remotekey + '/' + remoteId);
                            var remoteReceiveRef = self.ref.child('users/' + remoteId + '/receive/' + self.key + '/' + self.uid);
                            var localReceiveRef = self.ref.child('users/' + self.uid + '/receive/' + remotekey + '/' + remoteId);
                            var remoteSendRef = self.ref.child('users/' + remoteId + '/send/' + self.key + '/' + self.uid);
                            self.sendPeerConnection = new PeerConnection(localSendRef, remoteReceiveRef, configuration);
                            self.receivePeerConnection = new PeerConnection(localReceiveRef, remoteSendRef, configuration);
                            self.receivePeerConnection.on('addstream', function(stream) {
                                self.receiveStreamList[remoteId] = true;
                                var wildStream = new WildStream(remoteId);
                                wildStream.setStream(stream);
                                self.wildEmitter.emit('stream_added', wildStream);
                                // emit 'stream_removed'
                                wildData.onStreamRemove(remoteSendRef, function() {
                                    var wildStream = new WildStream(remoteId);
                                    wildStream.setStream(null);
                                    if (self.receiveStreamList[remoteId]) {
                                        delete self.receiveStreamList[remoteId];
                                        self.wildEmitter.emit('stream_removed', wildStream);

                                        wildData.offStreamRemove(remoteSendRef);
                                    }
                                });
                            });
                            self.receivePeerConnection.on('removestream', function() {
                                if (self.receiveStreamList[remoteId])
                                    delete self.receiveStreamList[remoteId];
                                var wildStream = new WildStream(remoteId);
                                wildStream.setStream(null);
                                self.wildEmitter.emit('stream_removed', wildStream);
                            });

                            self.receivePeerList[remoteId] = self.receivePeerConnection;
                            if (self.isAddStream) {
                                if (self.localStream != null) {
                                    self.sendPeerConnection.addStream(self.localStream.getStream(), function(err) {
                                        console.log('addstream');
                                    })
                                } else {
                                    self.getLocalStream(null, function(wildStream) {
                                        self.sendPeerConnection.addStream(wildStream.getStream(), function(err) {
                                            console.log('addstream default');
                                        })
                                    })
                                }
                                self.hasStreamList[remoteId] = self.sendPeerConnection;
                            } else {
                                self.noStreamList[remoteId] = self.sendPeerConnection;
                            }
                        })
                    });
                    wildData.onUserRemoved(self.uid, function(remoteId) {
                        if (self.hasStreamList[remoteId]) {
                            self.hasStreamList[remoteId].close();
                            delete self.hasStreamList[remoteId];
                        } else if (self.noStreamList[remoteId]) {
                            self.noStreamList[remoteId].close();
                            delete self.noStreamList[remoteId];
                        };
                        self.receivePeerList[remoteId].close();
                    });
                    callback();
                });
            }
        });
    });
}

WildRTC.prototype.leave = function() {
    this.ref.child('keys/' + this.uid).remove();
    for (var peer in this.hasStreamList) {
        if (this.hasStreamList[peer].signalingState != 'closed') {
            this.hasStreamList[peer].close();
            delete this.hasStreamList[peer];
        }
    }
    for (var peer in this.noStreamList) {
        if (this.noStreamList[peer].signalingState != 'closed') {
            this.noStreamList[peer].close();
            delete this.noStreamList[peer];
        }
    }
    for (var peer in this.receivePeerList) {
        if (this.receivePeerList[peer].signalingState != 'closed') {
            this.receivePeerList[peer].close();
            delete this.receivePeerList[peer];
        }
    }
    var wildData = new WildData(this.ref);
    wildData.leave(this.uid);
};

WildRTC.prototype.getLocalStream = function(options, callback, cancelCallback) {
    var self = this;
    if (options != null) {
        navigator.getUserMedia(options, function(stream) {
            var wildStream = new WildStream(self.uid);
            wildStream.setStream(stream);
            self.localStream = wildStream;
            callback(wildStream);
        }, function(err) {
            cancelCallback(err);
        })
    } else {
        navigator.getUserMedia({
            'audio': true,
            'video': true
        }, function(stream) {
            var wildStream = new WildStream(self.uid);
            wildStream.setStream(stream);
            self.localStream = wildStream;
            callback(wildStream);
        }, function(err) {
            cancelCallback(err);
        })
    }
};

WildRTC.prototype.addStream = function(wildStream) {
    var self = this;
    self.isAddStream = true;
    for (var peer in self.noStreamList) {
        self.noStreamList[peer].addStream(wildStream.getStream())
    }
};

WildRTC.prototype.removeStream = function() {
    this.isAddStream = false;
    for (var peer in this.hasStreamList) {
        this.hasStreamList[peer].close();
        this.noStreamList[peer] = this.hasStreamList[peer];
        delete this.hasStreamList[peer];
    }
};

WildRTC.prototype.on = function(string, callback, cancelCallback) {
    if (string != 'stream_added' && string != 'stream_removed') {
        cancelCallback();
    } else if (string == 'stream_added') {
        this.wildEmitter.on('stream_added', callback);
    } else if (string == 'stream_removed') {
        this.wildEmitter.on('stream_removed', callback);
    }
};

WildRTC.prototype.off = function(string) {

    if (string == 'stream_added' || string == 'stream_removed') {
        this.WildEmitter.off(string);
    }
};
