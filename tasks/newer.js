var fs = require('fs');
var path = require('path');

var async = require('async');
var rimraf = require('rimraf');

var util = require('../lib/util');

var counter = 0;
var configCache = {};

function cacheConfig(config) {
  ++counter;
  configCache[counter] = config;
  return counter;
}

function pluckConfig(id) {
  if (!configCache.hasOwnProperty(id)) {
    throw new Error('Failed to find id in cache');
  }
  var config = configCache[id];
  delete configCache[id];
  return config;
}

function createTask(grunt) {
  return function(taskName, targetName) {
    var tasks = [];
    var prefix = this.name;
    if (!targetName) {
      Object.keys(grunt.config(taskName)).forEach(function(targetName) {
        if (!/^_|^options$/.test(targetName)) {
          tasks.push(prefix + ':' + taskName + ':' + targetName);
        }
      });
      return grunt.task.run(tasks);
    }
    var args = Array.prototype.slice.call(arguments, 2).join(':');
    var options = this.options({
      cache: path.join(__dirname, '..', '.cache')
    });

    // support deprecated timestamps option
    if (options.timestamps) {
      grunt.log.warn('DEPRECATED OPTION.  Use the "cache" option instead');
      options.cache = options.timestamps;
    }

    var qualified = taskName + ':' + targetName;
    var stamp = util.getStampPath(options.cache, taskName, targetName);
    var repeat = grunt.file.exists(stamp);

    if (!repeat) {
      /**
       * This task has never succeeded before.  Process everything.  This is
       * less efficient than it could be for cases where some dest files were
       * created in previous runs that failed, but it makes things easier.
       */
      grunt.task.run([
        qualified + (args ? ':' + args : ''),
        'newer-postrun:' + qualified + ':-1:' + options.cache
      ]);
      return;
    }

    // This task has succeeded before.  Filter src files.

    var done = this.async();

    var originalConfig = grunt.config.get([taskName, targetName]);
    var config = grunt.util._.clone(originalConfig);

    /**
     * Special handling for tasks that expect the `files` config to be a string
     * or array of string source paths.
     */
    var srcFiles = true;
    if (typeof config.files === 'string') {
      config.src = [config.files];
      delete config.files;
      srcFiles = false;
    } else if (Array.isArray(config.files) &&
        typeof config.files[0] === 'string') {
      config.src = config.files;
      delete config.files;
      srcFiles = false;
    }

    var previous = fs.statSync(stamp).mtime;
    var files = grunt.task.normalizeMultiTaskFiles(config, targetName);
    util.filterFilesByTime(files, previous, function(err, newerFiles) {
      if (err) {
        return done(err);
      } else if (newerFiles.length === 0) {
        grunt.log.writeln('No newer files to process.');
        return done();
      }

      /**
       * If we started out with only src files in the files config,
       * transform the newerFiles array into an array of source files.
       */
      if (!srcFiles) {
        newerFiles = newerFiles.map(function(obj) {
          return obj.src;
        });
      }

      // configure target with only newer files
      config.files = newerFiles;
      delete config.src;
      delete config.dest;
      grunt.config.set([taskName, targetName], config);
      // because we modified the task config, cache the original
      var id = cacheConfig(originalConfig);

      // run the task, and attend to postrun tasks
      var tasks = [
        qualified + (args ? ':' + args : ''),
        'newer-postrun:' + qualified + ':' + id + ':' + options.cache
      ];
      grunt.task.run(tasks);

      done();
    });

  };
}


/** @param {Object} grunt Grunt. */
module.exports = function(grunt) {

  grunt.registerTask(
      'newer', 'Run a task with only those source files that have been ' +
      'modified since the last successful run.', createTask(grunt));

  var deprecated = 'DEPRECATED TASK.  Use the "newer" task instead';
  grunt.registerTask(
      'any-newer', deprecated, function() {
        grunt.log.warn(deprecated);
        var args = Array.prototype.join.call(arguments, ':');
        grunt.task.run(['newer:' + args]);
      });

  var internal = 'Internal task.';
  grunt.registerTask(
      'newer-postrun', internal, function(taskName, targetName, id, dir) {

        // if dir includes a ':', grunt will split it among multiple args
        dir = Array.prototype.slice.call(arguments, 3).join(':');
        grunt.file.write(util.getStampPath(dir, taskName, targetName), '');

        // reconfigure task if modified config was set
        if (id !== '-1') {
          grunt.config.set([taskName, targetName], pluckConfig(id));
        }

      });

  var clean = 'Remove cached timestamps.';
  grunt.registerTask(
      'newer-clean', clean, function(taskName, targetName) {
        var done = this.async();

        /**
         * This intentionally only works with the default cache dir.  If a
         * custom cache dir is provided, it is up to the user to keep it clean.
         */
        var cacheDir = path.join(__dirname, '..', '.cache');
        if (taskName && targetName) {
          cacheDir = util.getStampPath(cacheDir, taskName, targetName);
        } else if (taskName) {
          cacheDir = path.join(cacheDir, taskName);
        }
        if (grunt.file.exists(cacheDir)) {
          grunt.log.writeln('Cleaning ' + cacheDir);
          rimraf(cacheDir, done);
        } else {
          done();
        }
      });

};
