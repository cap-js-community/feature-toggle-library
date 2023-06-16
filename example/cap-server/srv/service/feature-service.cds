@protocol: 'rest'
@impl: './../handler/feature-service.js'
// NOTE: in practice this needs security restrictions
service FeatureService {
    type JSON {};
    function state() returns JSON;
    action redisRead() returns JSON;

    // NOTE: expects an object as input
    @open
    action redisUpdate(newValues: JSON);
}
