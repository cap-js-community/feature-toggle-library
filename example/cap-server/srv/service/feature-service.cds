@protocol: 'rest'
@impl: './../handler/feature-service.js'
// TODO in practice this would need security restrictions
service FeatureService {
    type JSON {};
    function state() returns JSON;
    action redisRead() returns JSON;

    // NOTE: expects an object as input
    @open
    action redisUpdate(newValues: JSON);
}
