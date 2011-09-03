jQuery(function($) {
    var tree = {};
    var flatdict = {};
    var jstree = {};
    var tm = Math.round((new Date()).getTime()/1000);
    var selected = [];
    $.ajax({
        'url': '/rrd/',
        'dataType': 'json',
        'success': buildtree
        });

    $("#tooltip").hide();
    $("#period").change(rebuildgraph);
    function setperiod(ev) {
        $("#period")[0].selectedIndex = parseInt(ev.data) - 1;
        rebuildgraph();
    }
    for(var i = 1, n = $('option', $("#period")).length+1; i < n; ++i) {
        $(window).keydown(i.toString(), setperiod);
    }
    $("#mode").change(rebuildgraph);
    $(window).keydown('m', function setperiod(ev) {
        var sel = $("#mode")[0];
        sel.selectedIndex = (sel.selectedIndex + 1) %
            $("option", $("#mode")).length;
        rebuildgraph();
    });

    function _mktree(name, obj, stack) {
        if(stack.length > 4) return {
            "data": name,
            "metadata": { "leaf": obj }
            };
        var children = [];
        for(var i in obj) {
            children.push(_mktree(i, obj[i], stack.concat([i])));
        }
        res =  {
            "data": name,
            "children": children
            }
        var rlen = jarred_rules.length;
        for(var i = 0; i < rlen; ++i) {
            var rule = jarred_rules[i];
            var m = jarred_rules[i].match;
            var mlen = m.length;
            if(stack.length != mlen) continue;
            var matched = true;
            for(var j = 0; j < mlen; ++j) {
                if(m[j] != null && m[j] != stack[j]) {
                    matched = false;
                    break;
                }
            }
            if(matched) {
                res.children.push({
                    "data": rule.label,
                    "metadata": {
                        "rule": rule,
                        "stack": stack }
                    });
            }
        }
        return res;
    }

    function buildtree(json) {
        flatdict = json;
        for(var i in json) {
            var path = i.split('.');
            path.splice(path.length-1, 1);
            path = path.join('.');
            var parts = path.split('/');
            console.assert(!parts[0]);
            host = parts[1];
            plug_inst = parts[2].split('-');
            plug = plug_inst.splice(0, 1)[0];
            pinst = plug_inst.join('-') || 'default';
            type_inst = parts[3].split('-');
            type = type_inst.splice(0, 1)[0];
            tinst = type_inst.join('-') || 'default';
            var thost = tree[host];
            if(!thost) thost = tree[host] = {};
            var tplug = thost[plug];
            if(!tplug) tplug = thost[plug] = {};
            var tpinst = tplug[pinst];
            if(!tpinst) tpinst = tplug[pinst] = {};
            var ttype = tpinst[type];
            if(!ttype) ttype = tpinst[type] = {};
            var ttinst = ttype[tinst];
            if(!ttinst) ttinst = ttype[tinst] = json[i];
            json[i].rrd = i;
        }
        jstree = _mktree('root', tree, []);
        $("#menu").jstree({
            "json_data": {
                "data": jstree.children
                },
            "plugins": ["themes", "json_data", "ui", "hotkeys"],
            "themes": {"theme": "default",
                       "url": "/css/jstree/default/style.css"}
        }).bind("select_node.jstree", function (event, data) {
            selected = data.inst.get_selected();
            rebuildgraph();
        }).bind("deselect_node.jstree", function (event, data) {
            selected = data.inst.get_selected();
            rebuildgraph();
        });
    }

    function rebuildgraph() {
        var files = {};
        var collections = [];
        $.each(selected, function (k, v) {
            var data = $(v).data();
            if(data.leaf) {
                if(!files[data.leaf.rrd]) {
                    files[data.leaf.rrd] = [];
                }
                var coll = {
                    "callback": convertgraph,
                    "data": []
                    };
                files[data.leaf.rrd].push(coll);
                collections.push(coll);
            } else if(data.rule) {
                var rrds = rulefiles(data);
                var coll = {
                    "callback": data.rule.convert,
                    "rule": data.rule,
                    "data": []
                    };
                for(var i = 0, n = rrds.length; i < n; ++i) {
                    if(!files[rrds[i].rrd]) {
                        files[rrds[i].rrd] = [];
                    }
                    files[rrds[i].rrd].push(coll);
                }
                collections.push(coll);
            }
        });
        var total = 0;
        var loaded = 0;
        var period = $("#period").val();
        for(var i in files) {
            ++ total;
            $.ajax({
                'url': '/rrd' + i
                    + '?start=' + (tm-period)
                    + '&end=' + tm + '&step=60&cf=AVERAGE',
                'dataType': 'json',
                'rrdpath': i,
                'success': function(json) {
                    var ff = files[this.rrdpath];
                    for(var i = 0, n = ff.length; i < n; ++i) {
                        ff[i].data.push(json);
                    }
                    ++loaded;
                    if(loaded < total) return;

                    var gdata = [];
                    for(var i = 0, n = collections.length; i < n; ++i) {
                        var coll = collections[i];
                        var ar = coll.callback.apply(
                            coll.rule, coll.data);
                        if(ar) {
                            gdata.push.apply(gdata, ar);
                        }
                    }
                    drawgraphs(gdata);
                }
            });
        }
    };

    function fnmatch_compile(pat) {
        res = ''
        for(var i = 0, n = pat.length; i < n;) {
            c = pat.charAt(i)
            i += 1
            switch(c) {
            case '*':
                res = res + '.*';
                break;
            case '?':
                res = res + '.';
                break;
            case '[':
                j = i
                if(j < n && pat.charAt(j) == '!')
                    j = j+1
                if(j < n && pat.charAt(j) == ']')
                    j = j+1
                while(j < n && pat.charAt(j) != ']')
                    j = j+1
                if(j >= n)
                    res = res + '\\['
                else {
                    stuff = pat.substr(i, j-i).replace('\\','\\\\')
                    i = j+1
                    if(stuff[0] == '!')
                        stuff = '^' + stuff.substr(1)
                    else if(stuff[0] == '^')
                        stuff = '\\' + stuff
                    res = res + '[' + stuff + ']'
                }
                break;
            default:
                // TODO(tailhook) escape more specials
                res = res + c.replace('.', '\\.');
                break;
            }
        }
        return res
    }

    function rulefiles(rule) {
        var subtree = tree;
        for(var i = 0; i < rule.stack.length; ++i) {
            subtree = subtree[rule.stack[i]];
        }
        var filtered = []
        var re = new RegExp(fnmatch_compile(rule.rule.fetch));
        function visit(tree) {
            if(tree.rrd) {
                if(re.exec(tree.rrd)) {
                    filtered.push(tree);
                }
                return;
            }
            for(var i in tree) {
                visit(tree[i]);
            }
        }
        visit(subtree);
        return filtered;
    }

    function convertgraph(json) {
        var data = [];
        for(var j = 0; j < json.datasets.length; ++j) {
            data.push({"label": json.datasets[j], "data": []});
        }
        for(var i = 0; i < json.data.length; ++i) {
            var row = json.data[i];
            var tm = (i*json.step + json.start)*1000;
            for(var j = 0; j < row.length; ++j) {
                var val = [tm, row[j]];
                data[j].data.push(val)
            }
        }
        return data;
    }
    function _drawgraph(data) {
        var g = $('<div class="graph">');
        $("#graph").append(g);
        $.plot(g, data, {
            'grid': { 'hoverable': true },
            'xaxis': { 'mode': 'time' }
        });
        g.bind('plothover', function (event, pos, item) {
            if(item) {
                var dt = new Date();
                dt.setTime(item.datapoint[0]*1000);
                $("#tooltip").text(item.datapoint[1] + ' at ' + dt)
                    .css({'left': item.pageX + 5, 'top': item.pageY + 5 })
                    .show();
            } else {
                $("#tooltip").hide();
            }
        });
    }
    function drawgraphs(data) {
        var $g = $("#graph").empty()
        switch($("#mode").val()) {
            case "normal":
                _drawgraph(data);
                break;
            case "multi-axes":
                for(var i = 0; i < data.length; ++i) {
                    data[i].yaxis = i+1;
                }
                _drawgraph(data);
                break;
            case "multi-graph":
                for(var i = 0; i < data.length; ++i) {
                    _drawgraph([data[i]]);
                }
                break;
        }
    }

    // Utility functions

    window.jarred = {
        'sum': function sum(values, fun) {
            var data = [];
            var start = 0;
            var first = values[0];
            for(var j = 0; j < first.data.length; ++j) {
                var val = 0;
                var ts = (first.start + first.step * j) * 1000;
                for(var i = 0; i < values.length; ++i) {
                    one = values[i].data[j][0];
                    if(isNaN(one) || one == null) {
                        // Better nothing than wrong value
                        val = null;
                        break;
                    }
                    if(fun) {
                        val += fun(one);
                    } else {
                        val += one;
                    }
                }
                data.push([ts, val]);
            }
            return [{"data": data}];
        }
    };
})
