@protocol: 'rest'
@impl: './../handler/check-service.js'
@path: '/check'
service CheckService {
    function priority() returns String;
}
