var express = require('express');
var bodyParser = require('body-parser');
var session = require('express-session');
var cookieParser = require('cookie-parser');
var flash = require('connect-flash');
var rp = require('request-promise');
var url = require('url');
var fsp = require('fs-promise');
var config = require(__dirname+'/config.json');

var port = config.appInternalPort;
var urlize = function(uri) {
    if (uri === undefined) uri = '';
    if (uri.charAt(0) === '/') uri = uri.substr(1);
    var protocol = config.https ? "https" : "http";
    var sitename = config.appExternalSite;
    return `${protocol}://${sitename}/${uri}`;
};
var makeIndexOutputFile = function() {
    var lines = [];
    return fsp.readdir(__dirname+'/img').then(function(files) {
        for (var i in files) {
            i = parseInt(i);
            var filename = files[i];
            var basename = filename.split('.').slice(0,-1).join('.');
            var ext = filename.split('.').pop();
            var label = ext==='gif' ? 'warning' : 'danger';
            var line = `<tr><td class="text-right">${i+1}</td><td><a href="/img/${filename}">${basename}</a><span class="label label-${label} pull-right">${ext}</span></td></tr>`;
            lines.push(line);
        }
        
        return fsp.readFile(__dirname+'/resources/index-template.html', 'utf-8');
    })
    .then(function(data) {
        data = data.replace('<!--table body-->', lines.join('\n'));
        return fsp.writeFile(__dirname+'/resources/index-output.html', data);
    });
};

var app = express();
app.use(bodyParser.urlencoded({extended:false}));
app.use(cookieParser(config.sessionSecret));
app.use(session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge:60000 }
}));
app.use(flash());

app.use(function(req, res, next) {
    console.log(`Got ${req.method} request with URI "${req.path}"`);
    next();
});
app.get('/', function(req, res) {
    res.sendFile(__dirname+'/resources/index-output.html');
});
app.get('/main.js', function(req, res) {
    res.sendFile(__dirname+'/resources/main.js');
});
app.get('/add', function(req, res) {
    fsp.readFile(__dirname+'/resources/add.html', 'utf-8').then(function(data) {
        data = data.replace('{{error}}', req.flash('add_error') || '');
        data = data.replace('{{url}}', req.flash('add_url') || '');
        data = data.replace('{{name}}', req.flash('add_name') || '');
        res.send(data);
    });
});
app.post('/add', function(req, res) {
    var add_error = '';
    var password = req.body.password;
    var img_url = req.body.img_url;
    var img_name = req.body.img_name;

    if (password != config.imageAdditionPassword) {
        add_error = 'Wrong password';
    }
    else if (img_url.trim() === '') {
        add_error = 'URL cannot be empty';
    }
    else if (url.parse(img_url).host === null) {
        add_error = 'URL is invalid';
    }
    else if (img_name.trim() === '') {
        add_error = 'Name cannot be empty';
    }
    else if (img_name.trim() === '') {
        add_error = 'Wrong password';
    }
    else if (fsp.existsSync(__dirname+'/img/'+img_name+'.gif')) {
        add_error = 'Name already in use';
    }
    else if (fsp.existsSync(__dirname+'/img/'+img_name+'.png')) {
        add_error = 'Name already in use';
    }

    if (add_error !== '') {
        req.flash('add_error', add_error);
        req.flash('add_url', img_url);
        req.flash('add_name', img_name);
        res.redirect(urlize('/add'));
    }
    else {
        var options = {
            method: 'GET',
            uri: img_url,
            encoding: null,
            resolveWithFullResponse: true,
        };
        rp(options).then(function(res2) {
            var ctype = res2.headers['content-type'];
            if (ctype === 'image/gif') {
                return fsp.writeFile(__dirname+'/img/'+img_name+'.gif', res2.body);
            }
            else if (['image/jpeg','image/pjpeg','image/png','image/x-png'].indexOf(ctype) >= 0) {
                return fsp.writeFile(__dirname+'/img/'+img_name+'.png', res2.body);
            }
            else {
                throw new Error(`Invalid MIME type "${ctype}"`);
            }
        }).then(function() {
            return makeIndexOutputFile();
        }).then(function(res3) {
            res.redirect(urlize('/'));
        }).catch(function(err) {
            req.flash('add_error', err.message);
            req.flash('add_url', img_url);
            req.flash('add_name', img_name);
            res.redirect(urlize('/add'));
        });
    }
});
app.get('/make', function(req, res) {
    makeIndexOutputFile().then(function() {
        res.redirect(urlize('/'));
    });
});
app.get('/search', function(req, res) {
    var q = req.query.q;
    console.log(`Got search request with query "${q}"`);
    var data = { q:q, results:[], error:'' };
    
    if (q===undefined || q==='') {
        data.error = 'Empty/Unspecified query (q parameter)';
    }
    else if (q.includes('..')) {
        data.error = 'Query cannot contain ".."';
    }
    else {
        if (fsp.existsSync(__dirname+'/img/'+q)) {
            data.results.push(urlize(q));
        }
        if (fsp.existsSync(__dirname+'/img/'+q+'.gif')) {
            data.results.push(urlize(q+'.gif'));
        }
        if (fsp.existsSync(__dirname+'/img/'+q+'.png')) {
            data.results.push(urlize(q+'.png'));
        }
        if (data.results.length === 0) {
            data.error = 'No results';
        }
    }
    
    res.send(data);
});
app.get('/:filename', function(req, res) {
    var filename = req.params.filename;
    if (filename.includes('..')) {
        res.status(403).send('Forbidden');
    }
    else if (fsp.existsSync(__dirname+'/img/'+filename)) {
        res.sendFile(__dirname+'/img/'+filename);
    }
    else if (fsp.existsSync(__dirname+'/img/'+filename+'.gif')) {
        res.sendFile(__dirname+'/img/'+filename+'.gif');
    }
    else if (fsp.existsSync(__dirname+'/img/'+filename+'.png')) {
        res.sendFile(__dirname+'/img/'+filename+'.png');
    }
    else {
        res.status(404).send('Not Found');
    }
});
app.post('/slack', function(req, res) {
    var command = req.body.command;
    var query = req.body.text.trim();
    var who = req.body.user_name;
    var team_name = req.body.team_domain;
    var channel_name = req.body.channel_name;
    console.log(`Got slack request "${command} ${query}" from @${who} in ${team_name}.${channel_name}`);
    var options = {
        method: 'GET',
        uri: `http://localhost:${port}/search`,
        qs: { q: query },
        resolveWithFullResponse: true,
        json: true,
    };
    rp(options).then(function(res2) {
        if (res2.body.error) {
            res.send(res2.body.error);
        }
        else {
            res.end();
            var image_url = res2.body.results[0];
            var payload = {
                response_type: 'in_channel',
                text: `<https://${team_name}.slack.com/messages/@${who}|@${who}> posted \`${command} ${query}\``,
                attachments: [
                    {
                        fallback: image_url,
                        color: 'good',
                        text: image_url,
                        image_url: image_url,
                    }
                ]
            };
            var options = {
                method: 'POST',
                uri: req.body.response_url,
                body: payload,
                json: true,
                resolveWithFullResponse: true,
            };
            rp(options);
        }
    });
});

app.listen(port, 'localhost', function() {
    console.log(`Server started on port ${port}...`);

    if (!fsp.existsSync(__dirname+'/resources/index-output.html')) {
        console.log('Generating index output file...');
        makeIndexOutputFile().then(function(res) {
            console.log('Looks like the index output was generated successfully.');
        });
    }
});
