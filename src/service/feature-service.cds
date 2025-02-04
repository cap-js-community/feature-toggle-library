@protocol: 'rest'

@impl: '@cap-js-community/feature-toggle-library/src/service/feature-service.js'
service FeatureService {
    @(requires: ['system-user'])
    function state() returns {};
    @(requires: ['system-user'])
    action redisRead() returns {};

    // NOTE: expects an object as input
    @(requires: ['system-user'])
    @open
    action redisUpdate(newValues: {});

    // NOTE: expects an object as input
    @(requires: [])
    @open
    action redisSendCommand(command: {}) returns String;
}
