module.exports = function(RED) {

    function PowerMateInNode(n) {

        var _self = this;

        RED.nodes.createNode(_self, n);
        
        // Retrieve the config node
        _self.device = RED.nodes.getNode(n.device);
        
        if(_self.device){

            // Listen for status changes
            _self.device.on('status', function(data){
                _self.status(data);
            });

            // Listen for knob notifications
            _self.device.on('knob', function(val){
                _self.send({
                    topic: "knob",
                    payload: val
                });
            });

            // Listen for battery notifications
            _self.device.on('battery', function(val){
                _self.send({
                    topic: "battery",
                    payload: val
                });
            });

        }

         _self.on("close", function() {

            // Unsubscribe from events

        });

    }

    RED.nodes.registerType("powermate-in", PowerMateInNode);

}