const fs = require('fs');
const path = require('path');
const Arrow = require('arrow');
const Validator = require('./validate');
const Persister = require('./persister');
const schemaContract = require('./contract/schema');
const modelContract = require('./contract/model');

//TODO: create model.js to define strategies there 
//TODO: create utils folder to put some standalone reusable utils

module.exports = {
    
    //Expose different strategies for model creation.
    //TODO: These could be hidden as well but are exposed to fit the Arrow Connector Lifecycle
    createModels: createModels,
    createAndLoadModelsFromFiles: createAndLoadModelsFromFiles,

    //TODO these should be invoked internally by exposed method called createSchema
    validateSchema: validateSchema,
    saveSchemaSync: Persister.saveSchemaSync
}

function createModels(schema, options) {
    return Object.keys(schema).reduce(function (swaggerModels, objectName) {
        const model = createModel(objectName, schema[objectName], options);
        Validator.validate(model, modelContract);
        const arrowModel = Arrow.Model.extend(model.name, model);
        bindModelMethods(arrowModel, options);
        swaggerModels[arrowModel.name] = arrowModel;
        //TODO only if configured to be saved
        //pass namespace from outside
        Persister.saveModelSync(model, options);
        return swaggerModels;
    }, {})
}

function validateSchema(schema) {
    Validator.validate(schema, schemaContract);
}

/**
 * Use internal mechanism to load models.
 * It first create and persist models on the file system and then load them with static Arrow method.
 */
function createAndLoadModelsFromFiles(schema, options) {
    createAndPersistModels(schema, options);
    return Arrow.loadModelsForConnector(options.connector.name, module, Persister.getModelsLocation(options.namespace));
}

function createAndPersistModels(schema, options) {
    Object.keys(schema).forEach(function (objectName) {
        const model = createModel(objectName, schema[objectName], options);
        Validator.validate(model, modelContract);
        Persister.saveModelSync(model, options);
    })
}

/**
 * Create object litteral (based on object data from schema) with structure appropriate to construct Arrow Model
 */
function createModel(objectName, obj, options) {
    const model = {
        name: createModelName(options.namespace, objectName),
        fields: obj.fields,

        //connector: options.connector.name,
        connector: options.connector,

        autogen: !!options.connector.config.modelAutogen,
        metadata: {},
        generated: true,
        methods: {}
    };
    model.metadata[options.connector.name] = {
        'object': `${objectName}`,
        'fields': obj.metadata
    };
    if (obj.methods && obj.methods.length > 0) {
        // Note that when we have actions on model but they are empty Arrow does not create endpoints
        model.actions = [];
        obj.methods.forEach(function (method) {
            model.actions.push(method.name);
            model.methods[method.name] = {
                json: true,
                generated: true,
                verb: method.verb,
                url: method.url,
                path: method.path,
                autogen: !!options.connector.config.modelAutogen,
                meta: {
                    nickname: method.operation && method.operation.operationId,
                    summary: method.operation && method.operation.summary,
                    notes: method.operation && method.operation.description
                },
                params: method.params || (method.operation && method.operation.parameters)
            };
        })
    }
    return model;
}

function createModelName(namespace, modelName) {
    return `${namespace}-${modelName}`;
}

function bindModelMethods(model, options) {
    Object.keys(model.methods).forEach(function (methodName) {
        const method = model.methods[methodName];
        const context = {
            model: model,
            connector: options.connector,
            methodName: methodName,
            method: method,
            handleResponse: options.connector.config.handleResponse,
            getPrimaryKey: options.connector.config.getPrimaryKey
        };
        model[methodName] = options.connector.execute.bind(context);
        model[methodName + 'API'] = options.connector.describe.bind(context);
    })
}