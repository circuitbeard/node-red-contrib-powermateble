module.exports = function(RED) {

    function PowerMateLedNode(n) {

        var _self = this;

        // Create the node
        RED.nodes.createNode(_self, n);
        
        // Retrieve the config node
        _self.device = RED.nodes.getNode(n.device);
        _self.brightness = n.brightness;

        if(_self.device){

            // Listen for status changes
            _self.device.on('status', function(data){
                _self.status(data);
            });


            // Listen for input
            _self.on('input', function(msg){
                var level = parseInt(_self.brightness || msg.payload);
                _self.device.setLedBrightness(level);
            });
        }

    }

    RED.nodes.registerType("powermate-led", PowerMateLedNode);

}