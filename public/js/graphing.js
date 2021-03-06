(function(window, $) {
    var slice = Array.prototype.slice;

    function Graph(id, builder) {
        this.id = id;
        this.datasets = [];
        this.hidden = {};
        this.builder = builder;
    }
    Graph.prototype.add_dataset = function(info, rrd, alldata, index) {
        this.datasets.push(info);
        if(!this.title) {
            this.title = info.title;
        }
        delete info.title;
        delete info.graph;
        var data = [];
        for(var i = 0, ni = alldata.length,
            tm = rrd.start*1000, step = rrd.step*1000;
            i < ni; ++i, tm += step) {
            data.push([tm, alldata[i][index]]);
        }
        info.data = data;
        if(!info.id) {
            info.id = this.id + '-' + this.datasets.length;
        }
    }
    function suffix_formatter(val, axis) {
        var diff = axis.max - axis.min;
        var prec = 0;
        if (diff > 1000000000) {
            prec = -8;
        } else if (diff > 1000000) {
            prec = -5;
        } else if (diff > 1000) {
            prec = -2;
        } else if (diff > 10) {
            prec = 0;
        } else if (diff > 2) {
            prec = 1;
        } else if (diff > 0.1) {
            prec = 2;
        } else {
            prec = 3;
        }

        if (val > 1000000000) {
            prec += 9;
            return (val / 1000000000).toFixed(Math.max(prec, 0)) + " G";
        } else if (val > 1000000) {
            prec += 6;
            return (val / 1000000).toFixed(Math.max(prec, 0)) + " M";
        } else if (val > 1000) {
            prec += 3;
            return (val / 1000).toFixed(Math.max(prec, 0)) + " k";
        } else {
            return val.toFixed(Math.max(prec, 0));
        }
    }
    Graph.prototype.make_div = function() {
        this.drawn = false;
        this.div = $("<div class='graph'>").attr('id', this.id);
        var self = this;
        this.div.bind('plothover', function (event, pos, item) {
            if(item) {
                var dt = new Date();
                dt.setTime(item.datapoint[0]);
                var ds = '{:02d}:{:02d}:{:02d} {}.{:02d}.{}'.format(
                    dt.getHours(), dt.getMinutes(), dt.getSeconds(),
                    dt.getDate(), dt.getMonth()+1, dt.getYear()+1900);
                var tt = $("#tooltip")
                tt.empty()
                tt.append('{2} at {0}<br>{1}'.format(ds, item.series.label,
                    suffix_formatter(item.datapoint[1], item.series.yaxis)));
                tt.css({'left': '0px'})
                tt.show();
                if(item.pageX + tt.width() + 5 > document.body.clientWidth) {
                    tt.css({'left': item.pageX  - tt.width() - 5,
                        'top': item.pageY + 5 })
                } else {
                    tt.css({'left': item.pageX + 5, 'top': item.pageY + 5 })
                }
            } else {
                $("#tooltip").hide();
            }
        }).bind('plotselected', function(event, ranges) {
            if(ranges.yaxis) {
                self.yranges = ranges;
            }
            self.invalidate();
            if(ranges.xaxis) {
                self.builder.set_xrange(ranges.xaxis);
            }
            self.builder.draw_visible();
        });
        return this.div;
    }
    Graph.prototype.draw = function() {
        if(this.drawn) return false;
        var y1r = this.yranges && this.yranges.yaxis;
        var y2r = this.yranges && this.yranges.y2axis;
        for(var i = 0, ni = this.datasets.length; i < ni; ++i) {
            var ds = this.datasets[i];
            if(!ds.lines) {
                ds.lines = {};
            }
            ds.lines['show'] = !this.hidden[ds.id];
        }
        $.plot(this.div, this.datasets, {
            'grid': { "hoverable": true },
            'crosshair': { "mode": $("#selmode").val() },
            'selection': { "mode": $("#selmode").val() },
            'legend': {
                'labelFormatter': function(label, series) {
                    return '<a name="'+series.id+'">' + label + '</a>';
                    },
                'position': 'nw'
                },
            'xaxis': {
                "mode": "time",
                "min": this.xrange && this.xrange.from,
                "max": this.xrange && this.xrange.to
                },
            'yaxes': [{
                'tickFormatter': suffix_formatter,
                'reserveSpace': true,
                'labelWidth': 64,
                'position': 'left',
                "min": y1r && y1r.from,
                "max": y1r && y1r.to
                }, {
                'tickFormatter': suffix_formatter,
                'labelWidth': 64,
                'reserveSpace': true,
                'position': 'right',
                "min": y2r && y2r.from,
                "max": y2r && y2r.to
                }]
            });
        var self = this;
        $("td.legendColorBox, td.legendLabel", this.div).click(function(ev) {
            var tr = $(ev.target).closest('tr');
            var series_id = $('a', tr).attr('name');
            self.hidden[series_id] = !self.hidden[series_id];
            self.invalidate();
            self.draw();
        });
        this.drawn = true;
        return true;
    }
    Graph.prototype.invalidate = function() {
        this.drawn = false;
    }
    Graph.prototype.reset = function() {
        this.xrange = null;
        this.yranges = null;
        this.hidden = {};
    }

    function Rules() {
        this.rules = [];
    }
    Rules.prototype.add_rule = function (rule) {
        this.rules.push(rule);
    }
    Rules.prototype.filter_files = function (files) {
        var output = [];
        var tm = +new Date();
        for(var i = 0, ni = files.length; i < ni; ++i) {
            var fn = files[i];
            for(var j = 0, nj = this.rules.length; j < nj; ++j) {
                var rule = this.rules[j];
                if(rule.match_rrd.test(fn)) {
                    output.push(fn);
                    break;
                }
            }
        }
        console.log("Matched", output.length, 'in', +new Date() - tm, 'ms');
        return output;
    }
    var _skip_props = {'match_rrd': 1, 'match_item': 2};
    var _subst_props = {'group': 1, 'graph': 1,
                        'title': 1, 'label': 1, 'id': 1};
    function _substitute(src, values) {
        var tgt = {};
        for(var i in src) {
            if(i in _skip_props)
                continue;
            if(i in _subst_props) {
                tgt[i] = src[i].format(values);
            } else {
                tgt[i] = src[i];
            }
        }
        return tgt;
    }
    function _aggregate(a, agg, data, index) {
        switch(agg) {
        case 'sum':
            for(var i = 0, ni = a.data.length; i < ni; ++i) {
                if(a.data[i][1] == null || data[i][index] == null) {
                    a.data[i][1] = null;
                } else {
                    a.data[i][1] += data[i][index];
                }
            }
            break;
        case 'diff':
            for(var i = 0, ni = a.data.length; i < ni; ++i) {
                if(a.data[i][1] == null || data[i][index] == null) {
                    a.data[i][1] = null;
                } else {
                    a.data[i][1] -= data[i][index];
                }
            }
            break;
        default:
            console.error("Unknown aggregation", a.aggregation);
        }
    }
    Rules.prototype.make_graphs = function (rrds, builder) {
        var tm = +new Date();
        var groups = {};
        var graphs = {};
        var datasets = {};
        for(var i = 0, ni = rrds.length; i < ni; ++i) {
            var rrd = rrds[i];
            var fn = rrd.filename;
            for(var j = 0, nj = this.rules.length; j < nj; ++j) {
                var rule = this.rules[j];
                var m = rule.match_rrd.exec(fn);
                if(!m)
                    continue;
                subs = {'rrd': m};
                for(var k = 0, nk = rrd.datasets.length; k < nk; ++k) {
                    var mi = rule.match_item;
                    if(typeof mi === 'string') {
                        m = (mi == rrd.datasets[k]) ? mi : null;
                    } else {
                        m = mi.exec(rrd.datasets[k]);
                    }
                    if(!m) {
                        continue;
                    }
                    subs.item = m;
                    var gparams = _substitute(rule, subs);
                    if(gparams.id) {
                        var ds = datasets[gparams.id];
                        if(ds && ds.aggregation) {
                            _aggregate(ds, ds.aggregation, rrd.data, k);
                            continue;
                        } else {
                            datasets[gparams.id] = gparams;
                        }
                    }
                    var g = graphs[gparams.graph];
                    if(g) {
                        g.add_dataset(gparams, rrd, rrd.data, k);
                    } else {
                        g = new Graph(gparams.graph, builder);
                        g.add_dataset(gparams, rrd, rrd.data, k);
                        graphs[g.id] = g;
                        var gr = groups[gparams.group];
                        if(gr) {
                            gr.push(g);
                        } else {
                            groups[gparams.group] = [g];
                        }
                    }
                }
            }
        }
        console.log("Grouped", groups, graphs,
                    "in", +new Date() - tm, 'ms');
        return groups;
    }

    function CustomRules() {
    }
    CustomRules.prototype.filter_files = function (filenames) {
        return filenames;
    }
    CustomRules.prototype.make_graphs = function (rrds, builder) {
        var tm = +new Date();
        var graphs = [];
        switch($("#mode").val()) {
        case 'normal':
            for(var i = 0, ni = rrds.length; i < ni; ++i) {
                var rrd = rrds[i];
                var fn = rrd.filename;
                var g = new Graph(fn, builder);
                for(var k = 0, nk = rrd.datasets.length; k < nk; ++k) {
                    g.add_dataset({
                        title: fn.substr(1),
                        label: rrd.datasets[k]
                        }, rrd, rrd.data, k);
                }
                graphs.push(g);
            }
            break;
        case 'single':
            var g = new Graph('all', builder);
            for(var i = 0, ni = rrds.length; i < ni; ++i) {
                var rrd = rrds[i];
                for(var k = 0, nk = rrd.datasets.length; k < nk; ++k) {
                    g.add_dataset({
                        title: 'All',
                        label: rrd.datasets[k]
                        }, rrd, rrd.data, k);
                }
            }
            graphs.push(g);
            break;
        case 'multi-axes':
            for(var i = 0, ni = rrds.length; i < ni; ++i) {
                var rrd = rrds[i];
                var fn = rrd.filename;
                var g = new Graph(fn, builder);
                for(var k = 0, nk = rrd.datasets.length; k < nk; ++k) {
                    g.add_dataset({
                        title: fn.substr(1),
                        yaxis: k+1,
                        label: rrd.datasets[k]
                        }, rrd, rrd.data, k);
                }
                graphs.push(g);
            }
            break;
        case 'multi-graph':
            for(var i = 0, ni = rrds.length; i < ni; ++i) {
                var rrd = rrds[i];
                var fn = rrd.filename;
                for(var k = 0, nk = rrd.datasets.length; k < nk; ++k) {
                    var g = new Graph(fn + '-' + rrd.datasets[k], builder);
                    g.add_dataset({
                        title: fn.substr(1),
                        label: rrd.datasets[k]
                        }, rrd, rrd.data, k);
                    graphs.push(g);
                }
            }
            break;
        case 'sum':
            var g = new Graph('Sum', builder);
            for(var i = 0, ni = rrds.length; i < ni; ++i) {
                var rrd = rrds[i];
                var fn = rrd.filename;
                for(var k = 0, nk = rrd.datasets.length; k < nk; ++k) {
                    if(!g.datasets.length) {
                        g.add_dataset({
                            title: fn.substr(1),
                            label: rrd.datasets[k]
                            }, rrd, rrd.data, k);
                    } else {
                        _aggregate(g.datasets[0], 'sum', rrd.data, k);
                    }
                }
            }
            graphs.push(g);
            break;
        case 'diff':
            var g = new Graph('Diff', builder);
            for(var i = 0, ni = rrds.length; i < ni; ++i) {
                var rrd = rrds[i];
                var fn = rrd.filename;
                for(var k = 0, nk = rrd.datasets.length; k < nk; ++k) {
                    if(!g.datasets.length) {
                        g.add_dataset({
                            title: fn.substr(1),
                            label: rrd.datasets[k]
                            }, rrd, rrd.data, k);
                    } else {
                        _aggregate(g.datasets[0], 'diff', rrd.data, k);
                    }
                }
            }
            graphs.push(g);
            break;
        }
        console.log("Instantiated", graphs, rrds,
                    "in", +new Date() - tm, 'ms');
        return {'': graphs};
    }

    function Builder(rules, filenames, content, menu) {
        this.rules = rules;
        this.filenames = filenames;
        this._cur_requests = [];
        this.content = content;
        this.menu = menu;
        var self = this;
        this.clean_requests = function () {
            var req = self._cur_requests;
            for(var i = 0, ni = req.length; i < ni; ++i) {
                req[i].abort();
            }
            self._cur_requests = [];
        }
    }
    Builder.prototype._request = function _request(props) {
        var req = $.ajax(props);
        this._cur_requests.push(req);
        return req;
    }
    Builder.prototype.download = function download(urls) {
        var requests = [];
        var self = this;
        for(var i = 0, ni = urls.length; i < ni; ++i) {
            requests.push(this._request({
                'url': urls[i] + '/index.json',
                'dataType': 'json'
                }).pipe(function(lst) {
                    var url = this.url;
                    // stripping out /index.json
                    url = url.substr(1, url.length - 11);
                    for(var i = 0, ni = lst.length; i < ni; ++i) {
                        // stripping out .rrd
                        lst[i] = url + lst[i].substr(0, lst[i].length-4);
                    }
                    return lst;
                }));
        }
        $.when.apply(null, requests)
            .always(this.clean_requests)
            .done(loaded_basic_data);

        var self = this;
        function loaded_basic_data() {
            var filenames = [];
            for(var i = 0, ni = arguments.length; i < ni; ++i) {
                filenames = filenames.concat(arguments[i]);
            }
            filenames = self.rules.filter_files(filenames);
            self.filenames = filenames;
            self.load_graphs();
        }
    }

    Builder.prototype.load_graphs = function() {
        var filenames = this.filenames;
        var requests = [];
        var tm = +new Date()/1000;
        var period = $("#period").val();
        var step = Math.round(period / 720);
        for(var i = 0, ni = filenames.length; i < ni; ++i) {
            requests.push(this._request({
                'url': filenames[i]+'.rrd.json'
                    + '?start=' + (tm-period)
                    + '&end=' + tm + '&step=' + step + '&cf=AVERAGE',
                'dataType': 'json'
                }).pipe(function(rrd, status, req) {
                    rrd.filename = this.url.split('.rrd.json')[0];
                    return rrd;
                }));
        }
        var self = this;
        $.when.apply($, requests).then(function () {
            self.process_rrds(arguments);
        });
    }

    Builder.prototype.process_rrds = function(rrds) {
        var allgr = this.all_graphs = [];
        var graphs = this.rules.make_graphs(rrds, this);
        var cont = this.content;
        var menu = this.menu;
        for(var i in graphs) {
            var glist = graphs[i];
            cont.append($('<a>').attr('name', i));
            if(menu) {
                menu.append($("<li>").append(
                    $('<a>').attr('href', '#'+i).text(i)
                    ));
            }
            cont.append($('<h2>').text(i || ''));
            for(var j = 0, nj = glist.length; j < nj; ++j) {
                var gr = glist[j];
                cont.append($('<h3>').text(gr.title || ''));
                cont.append(gr.make_div());
                allgr.push(gr);
            }
        }
        this.graphs = graphs;
        this.draw_visible();
        var self = this;
        $(window).scroll(function(ev) { self.draw_visible(); });
    }
    Builder.prototype.draw_visible = function() {
        var tm = +new Date();
        var top = $(window).scrollTop();
        var bottom = top + $(window).height();
        var gr = this.all_graphs;
        if(!gr) return;
        var lo = 0, hi = gr.length;
        // bisect left
        while(lo < hi) {
            var mid = (lo + hi) >> 1;
            var d = gr[mid].div;
            var v = d.offset().top + d.height();
            if(v < top) lo = mid+1;
            else hi = mid;
        }
        var first = lo;
        lo = 0, hi = gr.length;
        // bisect right
        while(lo < hi) {
            var mid = (lo + hi) >> 1;
            var d = gr[mid].div;
            var v = d.offset().top;
            if(bottom < v) hi = mid;
            else lo = mid+1;
        }
        var last = Math.min(lo, gr.length - 1);
        var drawn = 0;
        for(var i = first; i <= last; ++i) {
            if(gr[i].draw()) {
                drawn += 1;
            }
        }
        if(drawn) {
            console.log("Drawn", drawn, "in", +new Date() - tm, 'ms');
        }
    }
    Builder.prototype.stop = function stop() {
        this.clean_requests();
    }
    Builder.prototype.clean = function clean() {
        this.all_graphs = null;
        this.content.empty();
        if(this.menu) {
            this.menu.empty();
        }
        this.xrange = null;
    }
    Builder.prototype.redownload = function redownload() {
        this.stop();
        this.clean();
        this.load_graphs();
    }
    Builder.prototype.redraw = function() {
        for(var i = 0, ni = this.all_graphs.length; i < ni; ++i) {
            this.all_graphs[i].invalidate();
        }
        this.draw_visible();
    }
    Builder.prototype.set_xrange = function(range) {
        this.xrange = range;
        for(var i = 0, ni = this.all_graphs.length; i < ni; ++i) {
            this.all_graphs[i].xrange = range;
        }
        this.redraw();
    }
    Builder.prototype.reset = function() {
        this.xrange = null;
        for(var i = 0, ni = this.all_graphs.length; i < ni; ++i) {
            this.all_graphs[i].reset();
        }
        this.redraw();
    }

    window.Builder = Builder;
    window.Rules = Rules;
    window.CustomRules = CustomRules;
    window.Graph = Graph;
})(this, jQuery);

jQuery(function($) {
    $("#tooltip").hide();

    function select_next(selector) {
        var sel = $(selector);
        var all = $("option", sel).length;
        sel.prop('selectedIndex', (sel.prop('selectedIndex') + 1) % all);
        sel.change();
    }
    function select_prev(selector) {
        var sel = $(selector);
        var all = $("option", sel).length;
        sel.prop('selectedIndex', (sel.prop('selectedIndex') + all - 1) % all);
        sel.change();
    }

    var hk = new Hotkeys();
    hk.add_key('ph', function() { $('#period').val('3600').change(); });
    hk.add_key('pd', function() { $("#period").val('86400').change(); });
    hk.add_key('pw', function() { $("#period").val('604800').change(); });
    hk.add_key('pm', function() { $("#period").val('2678400').change(); });
    hk.add_key('py', function() { $("#period").val('31622400').change(); });
    hk.add_key('P pp', function() { select_next("#period"); });
    hk.add_key('<C-p>', function() { select_prev("#period"); });
    hk.add_key('sx', function() { $("#selmode").val('x').change(); });
    hk.add_key('sy', function() { $("#selmode").val('y').change(); });
    hk.add_key('sb', function() { $("#selmode").val('xy').change(); });
    hk.add_key('S ss', function() { select_next("#selmode"); });
    hk.add_key('<C-s>', function() { select_prev("#selmode"); });
    hk.add_key('mn', function() { $('#mode').val('normal').change(); });
    hk.add_key('m1', function() { $('#mode').val('single').change(); });
    hk.add_key('ma', function() { $('#mode').val('multi-axes').change(); });
    hk.add_key('mg', function() { $('#mode').val('multi-graph').change(); });
    hk.add_key('ms m+ m<S-=>', function() { $('#mode').val('sum').change(); });
    hk.add_key('md m-', function() { $('#mode').val('diff').change(); });
    hk.add_key('M mm', function() { select_next("#mode"); });
    hk.add_key('<C-m>', function() { select_prev("#mode"); });
    hk.add_key('<space>', function() { $("#reset").click(); });
    hk.add_key('<C-space>', function() { $("#refresh").click(); });
    hk.bind_to(document);
});
