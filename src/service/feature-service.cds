@protocol: 'rest'
@impl: './feature-service.js'
@(requires: ['system-user'])
service FeatureService {
    type JSON {};
    function state() returns JSON;
    action redisRead() returns JSON;

    // NOTE: expects an object as input
    @open
    action redisUpdate(newValues: JSON);

    // NOTE: expects an object as input
    @open
    action redisSendCommand(command: JSON) returns String;
}
