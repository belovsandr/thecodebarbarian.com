var _ = require('underscore');
var fs = require('fs');
var markdown = require('marked');
var jade = require('jade');
var file = require('file');

var Orchestrator = require('orchestrator');
var orchestrator = new Orchestrator();

var posts = require('./lib/posts');
var postsConfig = posts;

var templates = {
  index: null,
  post: null,
  list: null
};
var postsContent = {};
var postBySource = {};

var loadTemplate = function(path, key) {
  return function(callback) {
    fs.readFile(path, function(err, view) {
      if (err) {
        console.log('Error loading index template: ' + err);
        return callback(err);
      }
      templates[key] = jade.compile(view, { filename: path });
      callback(null);
    });
  };
};

orchestrator.add('loadIndex', loadTemplate('./lib/views/index.jade', 'index'));
orchestrator.add('loadPostTemplate', loadTemplate('./lib/views/post.jade', 'post'));
orchestrator.add('loadListTemplate', loadTemplate('./lib/views/list.jade', 'list'));

_.each(posts, function(post) {
  var taskName = 'load-' + post.src;
  orchestrator.add(taskName, function(callback) {
    fs.readFile(post.src, function(err, md) {
      if (err) {
        console.log('Error reading file: ' + err);
        return callback(err);
      }
      postsContent[post.src] = md;
      postBySource[post.src] = post;
      callback(null);
    });
  });
});

var tasks = ['loadIndex'];
var tags = {};
_.each(posts, function(post) {
  _.each(post.tags || [], function(tag) {
    tags[tag] = tags[tag] || [];
    tags[tag].push(post);
  });
});
_.each(tags, function(list, tag) {
  tags[tag] = _.sortBy(tags[tag], function(post) { return post.date.unix(); })
});

_.each(posts, function(post) {
  var taskName = 'post-' + post.title;
  tasks.push(taskName);
  var dependencies = ['loadPostTemplate', 'load-' + post.src];
  orchestrator.add(taskName, dependencies, function(callback) {
    var md = postsContent[post.src];
    var output = templates.post({ post: post, content: markdown(md.toString()), allPosts: postsConfig });
    file.mkdirs(post.dest.directory, 0777, function(err) {
      if (err) {
        console.log('Error making dir: ' + err);
        return callback(err);
      }
      fs.writeFile(file.path.join(post.dest.directory, post.dest.name), output,
        function(err) {
          if (err) {
            console.log('Error writing file: ' + err);
            return callback(err);
          }
          return callback(null);
      });
    });
  });
});

_.each(tags, function(list, tag) {
  var taskName = 'list-' + tag;
  tasks.push(taskName);
  // Build up tag pages. Depends on loading the list template and loading the md
  // for each individual post in the template
  var dependencies = ['loadListTemplate'];

  var loadingPosts = _.map(list, function(p) { return 'load-' + p.src; });
  dependencies = dependencies.concat(loadingPosts);

  orchestrator.add(taskName, dependencies, function(callback) {
    // Template should contain a list of posts, augmented with a preview of
    // their content (first line of markdown)
    var output = templates.list({
      tag: tag,
      posts: _.map(list, function(p) {
        var newPost = _.clone(p);
        var md = postsContent[p.src].toString();
        newPost.preview = markdown(md.substr(0, md.indexOf('\n')));
        return newPost;
      }).reverse(),
      allPosts: postsConfig
    });
    fs.writeFile('./bin/tag/' + tag.toLowerCase(), output, function(err) {
      if (err) {
        console.log('Error writing file: ' + err);
        return callback(err);
      }
      return callback(null);
    });
  });
});

var compileIndexDependencies = _.map(posts, function(post) {
  return taskName = 'post-' + post.title;
});
compileIndexDependencies.push('loadIndex');
orchestrator.add('compileIndex', compileIndexDependencies, function(callback) {
  var posts = _.map(postsContent, function(ignored, key) {
    var p = postBySource[key];
    var newPost = _.clone(p);
    var md = postsContent[p.src].toString();
    newPost.preview = markdown(md.substr(0, md.indexOf('\n')));
    return newPost;
  }).reverse();

  var output = templates.index({
    posts: posts,
    allPosts: postsConfig
  });
  fs.writeFile('./bin/index', output, function(err) {
    if (err) {
      console.log('Error writing index: ' + err);
      return callback(err);
    }
    return callback(null);
  });
});
tasks.push('compileIndex');

orchestrator.start(tasks, function(err) {
  if (err) {
    return console.log("Errors occurred: " + err + '\n' + err.stack);
  }
  console.log("Done");
});
