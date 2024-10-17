[server.js]

const express = require('express');
const config = require('./configLoader.js');
const multer = require('multer')({ dest: `./${config.folders.temp}` });
const api = require('./api.js');

let app = express();
app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

// 대시보드 관련 라우팅
app.get('/', (req, res) => res.redirect('/dashboard'));
app.get('/favicon.ico', api.favicon);
app.get('/dashboard', api.dashboard);
app.get('/projects', api.projects);
app.get('/runnable', api.contentTypes);
app.post('/import/:folder', multer.single('file'), api.import);
app.post('/create/:type/:folder', api.create);
app.post('/remove/:folder', api.remove);

// 정적 파일 서비스 설정
app.use(`/${config.folders.assets}`, express.static(`${require.main.path}/${config.folders.assets}`));
app.use(express.static('./'));

let port = config.port;
app.listen(port, () => {
  console.log(`h5p content type development server running on http://localhost:${port}/dashboard`);
});

// 파일 변경 감지 설정
if (config.files.watch) {
  const eye = require('livereload').createServer({
    exclusions: config?.files?.watchExclusions ?? []
  });
  eye.watch(config.folders.libraries);
}


[api.js]

const fs = require('fs');
const logic = require('./logic.js');
const config = require('./configLoader.js');
const supportedLanguages = require(`${require.main.path}/${config.folders.assets}/languageCatcher.js`);

let session = {
  name: 'main-session',
  language: 'en',
  status: ''
};

module.exports = {
  // Load favicon.ico file
  favicon: (request, response) => {
    try {
      const icon = fs.readFileSync(`${require.main.path}/favicon.ico`);
      response.set('Content-Type', 'image/x-icon');
      response.end(icon);
    } catch (error) {
      handleError(error, response);
    }
  },
  
  // Renders dashboard
  dashboard: async (request, response) => {
    try {
      manageSession(null, {
        language: request.query?.language,
        name: request.query?.session
      });
      const html = fs.readFileSync(`${require.main.path}/${config.folders.assets}/templates/dashboard.html`, 'utf-8');
      const labels = await getLangLabels();
      const languageFiles = logic.getFileList(`${config.folders.libraries}/h5p-editor-php-library/language`);
      const languages = {};
      for (let item of languageFiles) {
        const key = item.match(/language\/(.*?)\.js/)?.[1];
        languages[key] = supportedLanguages[key];
      }
      let input = {
        assets: config.folders.assets,
        api: config.api,
        status: session.status,
        language: session.language,
        languages: JSON.stringify(languages)
      };
      input = { ...input, ...labels };
      response.set('Content-Type', 'text/html');
      response.end(logic.fromTemplate(html, input));
      session.status = '';
    } catch (error) {
      handleError(error, response);
    }
  },
  
  // Lists runnable libraries (content types)
  contentTypes: async (request, response) => {
    try {
      const registry = await logic.getRegistry();
      const libraryDirs = await logic.parseLibraryFolders();
      if (!registry.runnable) {
        registry.runnable = {};
        const list = [];
        for (let item in registry.regular) {
          if (registry.regular[item].runnable && libraryDirs[registry.regular[item].id]) {
            list.push(item);
          }
        }
        list.sort();
        list.forEach(item => {
          registry.runnable[item] = registry.regular[item];
        });
      }
      response.set('Content-Type', 'application/json');
      response.end(JSON.stringify(registry.runnable));
    } catch (error) {
      handleError(error, response);
    }
  },
  
  // Lists content folders
  projects: async (request, response) => {
    try {
      const registry = await logic.getRegistry();
      const limit = parseInt(request.query.limit) || 10;
      const page = parseInt(request.query.page) || 0;
      const start = page * limit;
      const end = start + limit;
      const libraryDirs = await logic.parseLibraryFolders();
      const output = { list: [], total: 0 };
      const dirs = fs.readdirSync('content');
      const list = [];
      for (let item of dirs) {
        if (!fs.existsSync(`content/${item}/h5p.json`)) {
          continue;
        }
        const info = JSON.parse(fs.readFileSync(`content/${item}/h5p.json`, 'utf-8'));
        if (!registry.reversed[info.mainLibrary]) {
          continue;
        }
        list.push({ id: info.mainLibrary, title: info.title, folder: item });
      }
      list.sort((a, b) => a.title.localeCompare(b.title));
      output.total = list.length;
      output.list = list.slice(start, Math.min(end, list.length));
      response.set('Content-Type', 'application/json');
      response.end(JSON.stringify(output));
    } catch (error) {
      handleError(error, response);
    }
  },
  
  // Import zipped archive of content type
  import: (request, response) => {
    try {
      request.params.folder = request.params.folder.replaceAll(/[^a-zA-Z0-9 -]/g, '').replaceAll(' ', '-');
      const path = logic.import(request.params.folder, request.file.path);
      fs.rmSync(request.file.path);
      response.set('Content-Type', 'application/json');
      response.end(JSON.stringify({ path }));
    } catch (error) {
      handleError(error, response);
    }
  },
  
  // Create empty content type
  create: async (request, response) => {
    try {
      request.params.folder = request.params.folder.replaceAll(/[^a-zA-Z0-9 -]/g, '').replaceAll(' ', '-');
      const target = `content/${request.params.folder}`;
      if (fs.existsSync(target)) {
        response.set('Content-Type', 'application/json');
        response.end(JSON.stringify({ error: `"${target}" folder already exists` }));
        return;
      }
      fs.mkdirSync(target);
      logic.generateInfo(request.params.folder, request.params.type);
      fs.writeFileSync(`${target}/content.json`, JSON.stringify({}));
      response.set('Content-Type', 'application/json');
      response.end(JSON.stringify({ result: request.params.folder }));
    } catch (error) {
      handleError(error, response);
    }
  },
  
  // Delete a content folder
  remove: (request, response) => {
    try {
      fs.rmSync(`content/${request.params.folder}`, { recursive: true, force: true });
      response.set('Content-Type', 'application/json');
      response.end(JSON.stringify({ result: `removed "content/${request.params.folder}"` }));
    } catch (error) {
      handleError(error, response);
    }
  }
};

// Helper functions
const handleError = (error, response) => {
  console.error(error);
  response.set('Content-Type', 'application/json');
  response.end(JSON.stringify({ error: error.toString() }));
};

const manageSession = (folder, options) => {
  for (let key in options) {
    if (typeof options[key] !== 'undefined') {
      session[key] = options[key];
    }
  }
};

const getLangLabels = async () => {
  let langFile = `${require.main.path}/${config.folders.assets}/languages/${session.language}.json`;
  if (!fs.existsSync(langFile)) {
    langFile = `${config.folders.assets}/languages/en.json`;
  }
  return await logic.getFile(langFile, true);
};



[configLoader.js]

const fs = require('fs');
const userConfigFile = `${process.cwd()}/config.js`;
module.exports.path = process.cwd();
if (fs.existsSync(userConfigFile)) {
  module.exports = require(userConfigFile);
}
else {
  module.exports = require('./config.js');
}


[config.js]

module.exports = {
  port: 8080,
  folders: {
    assets: 'assets',
    libraries: 'libraries',
    temp: 'temp'
  },
  files: {
    watch: true,
    watchExclusions: [/node_modules\//],
    patterns: {
      allowed: /\.(json|png|jpg|jpeg|gif|bmp|tif|tiff|eot|ttf|woff|woff2|otf|webm|mp4|ogg|mp3|m4a|wav|txt|pdf|rtf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|csv|diff|patch|swf|md|textile|vtt|webvtt|gltf|glb|js|css|svg|xml)$/,
      ignored: /^\.|~$/gi
    }
  },
  urls: {
    registry: 'https://raw.githubusercontent.com/h5p/h5p-registry/main/libraries.json'
  },
  registry: 'libraryRegistry.json',
  saveFreq: 30
};

if (process.argv[3] && process.argv[2] === 'server') {
  module.exports.port = +process.argv[3];
}
module.exports.api = `http://localhost:${module.exports.port}`; // API 경로
  

[languageCatcher.js]

const config = require(`${require.main.path}/config.js`);

require(`${process.cwd()}/${config.folders.libraries}/h5p-editor-php-library/scripts/h5peditor.js`);

module.exports = ns.supportedLanguages;


[logic.js]

const fs = require('fs');
const superAgent = require('superagent');
const admZip = require("adm-zip");
const config = require('./configLoader.js');

// builds content from template and input
const fromTemplate = (template, input) => {
  for (let item in input) {
    template = template.replaceAll(`{${item}}`, input[item]);
  }
  return template;
};

// get file from source and optionally parse it as JSON
const getFile = async (source, parseJson) => {
  const local = source.indexOf('http') !== 0 ? true : false;
  let output;
  if (local) {
    if (!fs.existsSync(source)) {
      return '';
    }
    output = fs.readFileSync(source, 'utf-8');
  } else {
    output = (await superAgent.get(source).set('User-Agent', 'h5p-cli').ok(res => [200, 404].includes(res.status))).text;
  }
  if (output === '404: Not Found') {
    return '';
  }
  if (parseJson) {
    output = JSON.parse(output);
  }
  return output;
};

// generates list of files and their relative paths in a folder tree
const getFileList = (folder) => {
  const output = [];
  let toDo = [folder];
  let list = [];
  const compute = () => {
    for (let item of list) {
      const dirs = fs.readdirSync(item);
      for (let entry of dirs) {
        const file = `${item}/${entry}`;
        if (fs.lstatSync(file).isDirectory()) {
          toDo.push(file);
        } else {
          output.push(file);
        }
      }
    }
  };
  while (toDo.length) {
    list = toDo;
    toDo = [];
    compute();
  }
  return output;
};

// imports content type from zip archive file in the .h5p format
const importContent = (folder, archive) => {
  const target = `${config.folders.temp}/${folder}`;
  new admZip(archive).extractAllTo(target);
  fs.renameSync(`${target}/content`, `content/${folder}`);
  fs.renameSync(`${target}/h5p.json`, `content/${folder}/h5p.json`);
  fs.rmSync(target, { recursive: true, force: true });
  return folder;
};

// creates zip archive export file in the .h5p format
const exportContent = async (library, folder) => {
  const target = `${config.folders.temp}/${folder}`;
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target);
  fs.cpSync(`content/${folder}`, `${target}/content`, { recursive: true });
  fs.renameSync(`${target}/content/h5p.json`, `${target}/h5p.json`);
  fs.rmSync(`${target}/content/sessions`, { recursive: true, force: true });
  
  const files = getFileList(target);
  const zip = new admZip();
  for (let item of files) {
    const file = item;
    item = item.replace(target, '');
    let path = item.split('/');
    const name = path.pop();
    if (!config.files.patterns.allowed.test(name)) {
      continue;
    }
    path = path.join('/');
    zip.addLocalFile(file, path);
  }
  const zipped = `${target}.h5p`;
  zip.writeZip(zipped);
  fs.rmSync(target, { recursive: true, force: true });
  return zipped;
};

module.exports = {
  fromTemplate,
  getFile,
  getFileList,
  importContent,
  exportContent
};
