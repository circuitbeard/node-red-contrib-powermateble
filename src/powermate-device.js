/*
 # Copyright (c) 2015, Matt Brailsford, aka Circuitbeard <hi@circuitveard.co.uk>   
 #  
 # Permission to use, copy, modify, and/or distribute this software for  
 # any purpose with or without fee is hereby granted, provided that the  
 # above copyright notice and this permission notice appear in all copies.  
 #  
 # THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL  
 # WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED  
 # WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR  
 # BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES  
 # OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,  
 # WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,  
 # ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS  
 # SOFTWARE. 
 */

//TODO: Scan for devices

module.exports = function(RED) {

	"use strict";

    var noble  = require('noble');
    var events = require('events');
    var util   = require('util');

    var SERVICE_UUID 		= '25598cf7424040a69910080f19f91ebc';
	var BATTERY_CHAR_UUID 	= '50f09cc9fe1d4c79a962b3a7cd3e5584';
	var KNOB_CHAR_UUID 		= '9cf53570ddd947f3ba6309acefc60415';
	var LED_CHAR_UUID 		= '847d189e86ee4bd2966f800832b1259d';

	var DISCONNECTED_STATUS = {fill:"red",shape:"ring",text:"disconnected"};
	var SCANNING_STATUS 	= {fill:"yellow",shape:"ring",text:"scanning..."};
	var CONNECTED_STATUS 	= {fill:"green",shape:"dot",text:"connected"};

	var LED_BRIGHTNESS_MIN	= 161;
	var LED_BRIGHTNESS_MAX	= 191;

	var device_pool			= {};

	util.inherits(PowerMateBleDevice, events.EventEmitter);

	function PowerMateBleDevice(mac) {

		var _self = this;

		_self._mac 			= mac;
		_self._peripheral 	= undefined;
        _self._service 		= undefined;
        _self._batteryChar 	= undefined;
        _self._knobChar 	= undefined;
        _self._ledChar 		= undefined;

		_self.setMaxListeners(0);

		_self.init();

	}

	PowerMateBleDevice.prototype.init = function(){

		var _self = this;

		// Create scoped handlers
		_self._onDiscoverHandler 	= _self._onDiscover.bind(_self);
		_self._onStateChangeHandler = _self._onStateChange.bind(_self);
		_self._onConnectHandler 	= _self._onConnect.bind(_self);
		_self._onDisconnectHandler 	= _self._onDisconnect.bind(_self);
		_self._onBatteryReadHandler	= _self._onBatteryRead.bind(_self);
		_self._onKnobReadHandler	= _self._onKnobRead.bind(_self);

		// Setup noble
        noble.on('discover', _self._onDiscoverHandler);
        noble.on('stateChange', _self._onStateChangeHandler);

        // Trigger initial scan (if ready)
        _self._onStateChange(noble.state);

	}

	PowerMateBleDevice.prototype.setLedBrightness = function(level){

		var _self = this;

		// Check the LED characteristic is set
    	if(!_self._ledChar) return;

    	// Map percentage to min / max range
    	var mappedLevel = level >= 0 
    		? Math.round(_self._map(level, 0, 100, LED_BRIGHTNESS_MIN, LED_BRIGHTNESS_MAX))
    		: 160; // Pulse

    	// Write the value
		_self._ledChar.write(new Buffer([mappedLevel]), true, function(err){
        	if(err) console.log(err);
        });

    };

	PowerMateBleDevice.prototype.destroy = function(){

		var _self = this;

		// Disconnect peripheral
        if(_self._peripheral) {
        	_self._peripheral.disconnect();
        	_self._onDisconnect(null, true);
        }

        // Stop scanning
        noble.stopScanning();

        // Remove listeners
        noble.removeListener("stateChange", _self._onStateChangeHandler);
        noble.removeListener("discover", _self._onDiscoverHandler);

	}

	PowerMateBleDevice.prototype._onStateChange = function(state){

		var _self = this;

		if (state === 'poweredOn' && !_self._peripheral) {
			_self.emit("status", SCANNING_STATUS);
			noble.startScanning([SERVICE_UUID], false);
		}

	}

	PowerMateBleDevice.prototype._onDiscover = function(peripheral){

		var _self = this;

		// Check mac address matches
		if (_self._mac != peripheral.address) return;

		// Save the peripheral
		_self._peripheral = peripheral;

		// Listen for connection events
		_self._peripheral.on('connect', _self._onConnectHandler);
		_self._peripheral.on('disconnect', _self._onDisconnectHandler);

		// Attempt to connect
		_self._peripheral.connect(function(err){
			if(err) console.log(err);
		});

	}

	PowerMateBleDevice.prototype._onConnect = function(err){

		var _self = this;

		// Discover services and characteristics (filter serial data service)
		_self._peripheral.discoverSomeServicesAndCharacteristics([SERVICE_UUID], [BATTERY_CHAR_UUID, KNOB_CHAR_UUID, LED_CHAR_UUID], function (err, services, chars) {

			if(err) console.log(err);

			// Store the service
			_self._service = services[0];

			// Store the chars
			for(var i = 0; i < chars.length; i++){
				switch(chars[i].uuid){
					case BATTERY_CHAR_UUID:
						_self._batteryChar = chars[i];
						break;
					case KNOB_CHAR_UUID:
						_self._knobChar = chars[i];
						break;
					case LED_CHAR_UUID:
						_self._ledChar = chars[i];
						break;
				}
			}
			
			// Signup for battery notifications
			_self._batteryChar.notify(true, function(error) {
				console.log('PowerMateBleDevice: Signed up for battery notifications');
			});

			// Listen for battery notifications
			_self._batteryChar.on('read', _self._onBatteryReadHandler);

			// Signup for knob notifications
			_self._knobChar.notify(true, function(error) {
				console.log('PowerMateBleDevice: Signed up for knob notifications');
			});

			// Listen for knob notifications
			_self._knobChar.on('read', _self._onKnobReadHandler);

		});

		_self.emit("status", CONNECTED_STATUS);

	}

	PowerMateBleDevice.prototype._onDisconnect = function(err, closing){
		
		var _self = this;

		// Remove handlers
		if(_self._peripheral) {
			_self._peripheral.removeListener("connect", _self._onConnectHandler);
			_self._peripheral.removeListener("disconnect", _self._onDisconnectHandler);
		};

		if(_self._knobChar) {
			_self._knobChar.removeListener("read", _self._onKnobReadHandler);
		};

		if(_self._batteryChar) {
			_self._batteryChar.removeListener("read", _self._onBatteryReadHandler);
		};

		// Get rid of the peripheral and characteristic references
	    delete _self._peripheral;
	    delete _self._service;
	    delete _self._batteryChar;
	    delete _self._knobChar;
	    delete _self._ledChar;

	    if(!closing){

	    	_self.emit("status", DISCONNECTED_STATUS);

	    	_self._onStateChange(noble.state);
	    }

	}

	PowerMateBleDevice.prototype._onBatteryRead = function(data, isNotification)
	{
		var _self = this;

		var value = parseInt(data.toString('hex'), 16);

		_self.emit("battery", value);
	}

	PowerMateBleDevice.prototype._onKnobRead = function(data, isNotification)
	{
		var _self = this;

		var rawValue = parseInt(data.toString('hex'), 16);
		var parsedValue = undefined;

		switch(rawValue){

			case 101:
				parsedValue = "release"
				break;
			case 104: 
				parsedValue = "clockwise"
				break;
			case 103: 
				parsedValue = "anticlockwise"
				break;

			
			case 114: 
			case 115: 
			case 116: 
			case 117: 
			case 118: 
			case 119: 
				parsedValue = "hold"  + (rawValue-113);
				break;
			case 112: 
				parsedValue = "holdClockwise"
				break;
			case 105: 
				parsedValue = "holdAnticlockwise"
				break;
			case 102: 
				parsedValue = "holdRelease"
				break;
		}

		if(parsedValue) {
			_self.emit("knob", parsedValue);	
		}
	}

	PowerMateBleDevice.prototype._map = function(x,  in_min,  in_max,  out_min,  out_max) {
    	return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
    };

    function PowerMateDeviceNode(n) {

    	var _self = this;
        
        // Create node
        RED.nodes.createNode(_self, n);

        // Hookup event emitter
        events.EventEmitter.call(_self);

        // Unlimited listeners
        _self.setMaxListeners(0);

        // Parse MAC address
        _self.mac = n.mac;

        // Init
        if(_self.mac){

        	// Create powermate instance
        	if(!device_pool.hasOwnProperty(_self.mac)){
        		device_pool[_self.mac] = new PowerMateBleDevice(_self.mac);
        	}

        	// Proxy events
        	device_pool[_self.mac].on('status', function(data){
        		_self.emit("status", data);
        	});
        	device_pool[_self.mac].on('knob', function(data){
        		_self.emit("knob", data);
        	});
        	device_pool[_self.mac].on('battery', function(data){
        		_self.emit("battery", data);
        	});
        }

        // Handlers
        _self.on("close", function() {

        	if(_self.mac && device_pool.hasOwnProperty(_self.mac)){
        		device_pool[_self.mac].destroy();
        		delete device_pool[_self.mac];
        	}

        });

        // Public methods
        _self.setLedBrightness = function(level){

	    	if(_self.mac && device_pool.hasOwnProperty(_self.mac)){
	    		device_pool[_self.mac].setLedBrightness(level);
	        }

	    };

    };

    RED.nodes.registerType("powermate-device", PowerMateDeviceNode);

}