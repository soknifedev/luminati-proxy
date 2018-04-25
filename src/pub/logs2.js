// LICENSE_CODE ZON ISC
'use strict'; /*jslint react:true, es6:true*/
import Pure_component from '../../www/util/pub/pure_component.js';
import React from 'react';
import _ from 'lodash';
import moment from 'moment';
import classnames from 'classnames';
import setdb from 'hutil/util/setdb';
import etask from 'hutil/util/etask';
import ajax from 'hutil/util/ajax';
import zescape from 'hutil/util/escape';
import util from './util.js';
import filesaver from 'file-saver';
import $ from 'jquery';
import {Tooltip, status_codes, is_json_str} from './common.js';
import JSON_viewer from './json_viewer.js';
import codemirror from 'codemirror/lib/codemirror';
import 'codemirror/lib/codemirror.css';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/mode/htmlmixed/htmlmixed';

const H_tooltip = props=><Tooltip className="har_tooltip" {...props}/>;

class Logs extends Pure_component {
    moving_width = false;
    min_width = 50;
    min_height = 100;
    state = {
        cur_preview: null,
        network_width: 200,
        logs_height: 600,
    };
    componentDidMount(){
        window.document.addEventListener('mousemove', this.on_mouse_move);
        window.document.addEventListener('mouseup', this.on_mouse_up);
    }
    open_preview = req=>this.setState({cur_preview: req});
    close_preview = ()=>this.setState({cur_preview: null});
    start_moving_width = e=>{
        if (e.nativeEvent.which!=1)
            return;
        this.moving_width = true;
        $(this.main_panel).addClass('moving');
        this.start_offset = e.pageX;
        this.start_width = this.state.network_width;
    };
    start_moving_height = e=>{
        if (e.nativeEvent.which!=1)
            return;
        this.moving_height = true;
        $('body').addClass('moving_height');
        $(this.main_panel).addClass('moving_height');
        this.start_offset = e.pageY;
        this.start_height = this.state.logs_height;
    };
    on_resize_width = e=>{
        const offset = e.pageX-this.start_offset;
        let new_width = this.start_width+offset;
        if (new_width<this.min_width)
            new_width = this.min_width;
        const max_width = this.main_panel.offsetWidth-this.min_width;
        if (new_width>max_width)
            new_width = max_width;
        this.setState({network_width: new_width});
    };
    on_resize_height = e=>{
        const offset = e.pageY-this.start_offset;
        let new_height = this.start_height-offset;
        if (new_height<this.min_height)
            new_height = this.min_height;
        this.setState({logs_height: new_height});
    };
    on_mouse_move = e=>{
        if (this.moving_width)
            this.on_resize_width(e);
        else if (this.moving_height)
            this.on_resize_height(e);
    };
    on_mouse_up = ()=>{
        this.moving_width = false;
        this.moving_height = false;
        $(this.main_panel).removeClass('moving');
        $(this.main_panel).removeClass('moving_height');
        $('body').removeClass('moving_height');
    };
    set_main_panel_ref = ref=>{ this.main_panel = ref; };
    render(){
        const preview_style = {
            maxWidth: `calc(100% - ${this.state.network_width}px`};
        const main_style = {
            height: this.state.logs_height,
        };
        return (
            <div className="har_viewer panel_style">
              <div className="main_panel vbox"
                style={main_style}
                ref={this.set_main_panel_ref}>
                <Toolbar close_preview={this.close_preview}/>
                <div className="split_widget vbox flex_auto">
                  <Network_container
                    main_panel={this.main_panel}
                    open_preview={this.open_preview}
                    width={this.state.network_width}
                    cur_preview={this.state.cur_preview}/>
                  <Preview cur_preview={this.state.cur_preview}
                    style={preview_style}
                    close_preview={this.close_preview}/>
                  <Network_resizer show={!!this.state.cur_preview}
                    start_moving={this.start_moving_width}
                    offset={this.state.network_width}/>
                </div>
                <Window_resizer
                  start_moving={this.start_moving_height}/>
              </div>
            </div>
        );
    }
}

class Toolbar extends Pure_component {
    clear = ()=>{
        const _this = this;
        this.etask(function*(){
            $('body').addClass('waiting');
            yield ajax({url: '/api/logs_reset'});
            _this.props.close_preview();
            setdb.set('head.har_viewer.reqs', []);
            setdb.set('head.har_viewer.stats', {total: 0, sum_out: 0,
                sum_in: 0});
            $('body').removeClass('waiting');
        });
    };
    render(){
        return (
            <div className="toolbar_container">
              <div className="toolbar">
                <Toolbar_button id="clear" tooltip="Clear"
                  on_click={this.clear}/>
              </div>
            </div>
        );
    }
}

const Toolbar_button = ({id, tooltip, on_click, tooltip_placement})=>(
    <H_tooltip title={tooltip} placement={tooltip_placement||'top'}>
      <div className={classnames('toolbar_item toolbar_button', id)}
        onClick={on_click}>
        <span className={id}/>
      </div>
    </H_tooltip>
);

const Window_resizer = ({start_moving})=>{
    return <div className="logs_resizer" onMouseDown={start_moving}/>;
};

const Network_resizer = ({show, offset, start_moving})=>{
    if (!show)
        return null;
    return (
        <div className="data_grid_resizer" style={{left: offset-2}}
          onMouseDown={start_moving}/>
    );
};

class Network_container extends Pure_component {
    moving_col = null;
    min_width = 22;
    uri = '/api/logs';
    batch_size = 100;
    loaded = {from: 0, to: 0};
    cols = [
        {title: 'Name', data: 'request.url'},
        {title: 'Status', data: 'response.status'},
        {title: 'Port', data: 'details.port'},
        {title: 'Bandwidth', data: 'details.bw'},
        {title: 'Time', data: 'time'},
        {title: 'Peer proxy', data: 'details.proxy_peer'}
    ];
    state = {
        focused: false,
        reqs: [],
        sorted: {col: 0, dir: 1},
        stats: {total: 0, sum_out: 0, sum_in: 0},
    };
    componentWillMount(){ this.get_data(); }
    componentDidMount(){
        this.resize_columns();
        window.onresize = ()=>{ this.resize_columns(); };
        window.document.addEventListener('mousemove', this.on_mouse_move);
        window.document.addEventListener('mouseup', this.on_mouse_up);
        this.setdb_on('head.har_viewer.reqs', reqs=>{
            if (!reqs)
                return;
            this.setState({reqs});
        });
        this.setdb_on('head.har_viewer.stats', stats=>{
            if (!stats)
                return;
            this.setState({stats});
        });
        this.setdb_on('head.ws', ws=>{
            if (!ws||this.ws)
                return;
            this.start_listening_ws(ws);
        });
    }
    willUnmount(){
        window.onresize = null;
        if (this.ws)
            this.ws.removeEventListener('message', this.on_ws_message);
    }
    fetch_missing_data = pos=>{
        if (pos=='bottom')
            this.get_data({skip: this.loaded.to});
    };
    get_data = (opt={})=>{
        opt.limit = opt.limit||this.batch_size;
        opt.skip = opt.skip||0;
        const _this = this;
        this.etask(function*(){
            const params = opt;
            const url = zescape.uri(_this.uri, params);
            const res = yield ajax.json({url});
            const sorted = _this.sort_reqs(res.log.entries);
            setdb.set('head.har_viewer.reqs',
                [..._this.state.reqs, ...sorted]);
            _this.loaded.to = opt.skip+sorted.length;
            if (!_this.state.stats.total)
            {
                setdb.set('head.har_viewer.stats', {total: res.total,
                    sum_out: res.sum_out, sum_in: res.sum_in});
            }
        });
    };
    sort_reqs(reqs, sort={col: 0, dir: 1}){
        const col = this.cols[sort.col];
        return reqs.slice().sort((a, b)=>{
            const val_a = _.get(a, col.data);
            const val_b = _.get(b, col.data);
            return val_a > val_b ? 1*sort.dir : -1*sort.dir;
        });
    }
    set_sort = idx=>{
        const new_sorted = {col: idx,
            dir: this.state.sorted.col==idx ? this.state.sorted.dir*-1 : 1};
        const sorted_reqs = this.sort_reqs(this.state.reqs, new_sorted);
        this.setState({reqs: sorted_reqs, sorted: new_sorted});
    };
    on_focus = ()=>this.setState({focused: true});
    on_blur = ()=>this.setState({focused: false});
    start_listening_ws(ws){
        this.ws = ws;
        ws.addEventListener('message', this.on_ws_message);
    }
    on_ws_message = event=>{
        const req = JSON.parse(event.data);
        this.setState(prev=>({
            reqs: [...prev.reqs, req],
            stats: {
                total: prev.stats.total+1,
                sum_out: prev.stats.sum_out+req.details.out_bw,
                sum_in: prev.stats.sum_in+req.details.in_bw,
            },
        }));
    };
    on_mouse_up = ()=>{
        this.moving_col = null;
        $(this.props.main_panel).removeClass('moving');
    };
    resize_columns = ()=>{
        const total_width = this.network_container.offsetWidth;
        const width = total_width/this.cols.length;
        const cols = this.cols.map((c, idx)=>({...c, width,
            offset: width*idx}));
        this.setState({cols});
    };
    start_moving = (e, idx)=>{
        if (e.nativeEvent.which!=1)
            return;
        $(this.props.main_panel).addClass('moving');
        this.moving_col = idx;
        this.start_offset = e.pageX;
        this.start_width = this.state.cols[idx].width;
        this.start_width_last = this.state.cols.slice(-1)[0].width;
    };
    on_mouse_move = e=>{
        if (this.moving_col===null)
            return;
        this.setState(prev=>{
            let offset = e.pageX-this.start_offset;
            if (this.start_width_last-offset<this.min_width)
                offset = this.start_width_last-this.min_width;
            if (this.start_width+offset<this.min_width)
                offset = this.min_width-this.start_width;
            let total_width = 0;
            const cols = prev.cols.map((c, idx)=>{
                if (idx<this.moving_col)
                {
                    total_width = total_width+c.width;
                    return c;
                }
                else if (idx==this.moving_col)
                {
                    const width = this.start_width+offset;
                    total_width = total_width+width;
                    return {...c, width, offset: total_width-width};
                }
                else if (idx==this.state.cols.length-1)
                {
                    const width = this.start_width_last-offset;
                    return {...c, width, offset: total_width};
                }
                total_width = total_width+c.width;
                return {...c, offset: total_width-c.width};
            });
            return {cols};
        });
    };
    set_network_ref = ref=>{ this.network_container = ref; };
    render(){
        const style = {};
        if (!!this.props.cur_preview)
        {
            style.flex = `0 0 ${this.props.width}px`;
            style.width = this.props.width;
        }
        return (
            <div className="network_container vbox"
              tabIndex="-1"
              style={style}
              onFocus={this.on_focus}
              onBlur={this.on_blur}
              ref={this.set_network_ref}>
              <div className="reqs_container">
                <Header_container cols={this.state.cols}
                  sort={this.set_sort}
                  sorted={this.state.sorted}
                  only_name={!!this.props.cur_preview}/>
                <Data_container cols={this.state.cols}
                  fetch_missing_data={this.fetch_missing_data}
                  reqs={this.state.reqs}
                  focused={this.state.focused}
                  cur_preview={this.props.cur_preview}
                  open_preview={this.props.open_preview}/>
                <Grid_resizers cols={this.state.cols}
                  show={!this.props.cur_preview}
                  start_moving={this.start_moving}/>
              </div>
              <Network_summary_bar stats={this.state.stats}/>
            </div>
        );
    }
}

class Network_summary_bar extends Pure_component {
    render(){
        let {total, sum_in, sum_out} = this.props.stats;
        sum_out = util.bytes_format(sum_out)||'0 B';
        sum_in = util.bytes_format(sum_in)||'0 B';
        const c = `${total} requests | ${sum_out} sent | ${sum_in} received`;
        return (
            <div className="network_summary_bar">
              <span>
                <H_tooltip title={c}>{c}</H_tooltip>
              </span>
            </div>
        );
    }
}

const Grid_resizers = ({cols, start_moving, show})=>{
    if (!show||!cols)
        return null;
    return (
        <div>
          {cols.slice(0, -1).map((c, idx)=>(
            <div key={c.title} style={{left: c.width+c.offset-2}}
              onMouseDown={e=>start_moving(e, idx)}
              className="data_grid_resizer"/>
          ))}
        </div>
    );
};

const Header_container = ({cols, only_name, sorted, sort})=>{
    if (!cols)
        return null;
    if (only_name)
        cols = cols.slice(0, 1);
    return (
        <div className="header_container">
          <table>
            <colgroup>
              {cols.map(c=>(
                <col key={c.title}
                  style={{width: only_name ? 'auto' : c.width}}/>
              ))}
            </colgroup>
            <tbody>
              <tr>
                {cols.map((c, i)=>(
                  <th key={c.title} onClick={()=>sort(i)}>
                    <div>{c.title}</div>
                    <Sort_icon show={i==sorted.col} dir={sorted.dir}/>
                  </th>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
    );
};

const Sort_icon = ({show, dir})=>{
    if (!show)
        return null;
    const classes = classnames('small_icon_mask', {sort_asc: dir==1,
        sort_desc: dir==-1});
    return <div className="sort_icon"><span className={classes}/></div>;
};

class Data_container extends Pure_component {
    componentDidMount(){
        this.dc.addEventListener('scroll', this.on_scroll, false);
    }
    willUnmount(){
        this.dc.removeEventListener('scroll', this.on_scroll, false);
    }
    set_dc_ref = ref=>{ this.dc = ref; };
    on_scroll = ()=>{
        if (this.dc.scrollTop==0)
            this.props.fetch_missing_data('top');
        if (this.dc.scrollHeight-this.dc.scrollTop==this.dc.offsetHeight)
            this.props.fetch_missing_data('bottom');
    };
    render(){
        let {cols, open_preview, cur_preview, focused, reqs} = this.props;
        const preview_mode = !!cur_preview;
        cols = (cols||[]).map((c, idx)=>{
            if (!preview_mode)
                return c;
            if (preview_mode&&idx==0)
                return {...c, width: 'auto'};
            return {...c, width: 0};
        });
        return (
            <div ref={this.set_dc_ref} className="data_container">
              <table>
                <colgroup>
                  {cols.map(c=>(
                    <col key={c.title} style={{width: c.width}}/>
                  ))}
                </colgroup>
                <Data_rows reqs={reqs}
                  cols={cols}
                  open_preview={open_preview}
                  cur_preview={cur_preview}
                  focused={focused}/>
              </table>
            </div>
        );
    }
}

class Data_rows extends React.Component {
    shouldComponentUpdate(next_props){
        return next_props.reqs!=this.props.reqs ||
            next_props.cur_preview!=this.props.cur_preview ||
            next_props.focused!=this.props.focused;
    }
    render(){
        return (
            <tbody>
              {this.props.reqs.map(r=>(
                <Data_row cols={this.props.cols} key={r.uuid}
                  open_preview={this.props.open_preview}
                  cur_preview={this.props.cur_preview}
                  focused={this.props.focused} req={r}/>
              ))}
              <tr className="filler">
                {this.props.cols.map(c=><td key={c.title}/>)}
              </tr>
            </tbody>
        );
    }
}

class Data_row extends React.Component {
    shouldComponentUpdate(next_props){
        const selected = (this.props.cur_preview==this.props.req);
        const will_selected = (next_props.cur_preview==next_props.req);
        const selection_changed = selected!=will_selected;
        const focused_changed = this.props.focused!=next_props.focused;
        return selection_changed||focused_changed&&selected;
    }
    render(){
        const {cur_preview, open_preview, cols, focused, req} = this.props;
        const classes = classnames({
            selected: cur_preview==req,
            focused: cur_preview==req&&focused,
        });
        return (
            <tr className={classes}>
              {cols.map(c=>(
                <td key={c.title} onClick={()=>open_preview(req)}>
                  <Cell_value col={c.title} req={req}/>
                </td>
              ))}
            </tr>
        );
    }
}

const Cell_value = ({col, req})=>{
    if (col=='Name')
    {
        return (
            <H_tooltip title={req.request.url}>
              <div>
                <img className="icon script"/>
                <div className="disp_value">{req.request.url}</div>
              </div>
            </H_tooltip>
        );
    }
    else if (col=='Status')
    {
        const status = status_codes[req.response.status];
        return (
            <H_tooltip title={req.response.status+' '+status}>
              <div className="disp_value">{req.response.status}</div>
            </H_tooltip>
        );
    }
    else if (col=='Port')
        return <Tooltip_and_value val={req.details.port}/>;
    else if (col=='Bandwidth')
        return <Tooltip_and_value val={util.bytes_format(req.details.bw)}/>;
    else if (col=='Time')
        return <Tooltip_and_value val={req.time+' ms'}/>;
    else if (col=='Peer proxy')
        return <Tooltip_and_value val={req.details.proxy_peer}/>;
    return col;
};

const Tooltip_and_value = ({val})=>(
    <H_tooltip title={val}>
      <div className="disp_value">{val}</div>
    </H_tooltip>
);

class Preview extends Pure_component {
    panes = [
        {id: 'headers', width: 65, comp: Pane_headers},
        {id: 'preview', width: 63, comp: Pane_preview},
        {id: 'response', width: 72, comp: Pane_response},
        {id: 'timing', width: 57, comp: Pane_timing},
    ];
    state = {cur_pane: 0};
    select_pane = id=>{ this.setState({cur_pane: id}); };
    render(){
        if (!this.props.cur_preview)
            return null;
        const Pane_content = this.panes[this.state.cur_pane].comp;
        const req = this.props.cur_preview;
        return (
            <div style={this.props.style} className="preview_container">
              <div className="tabbed_pane_header">
                <div className="left_pane">
                  <div onClick={this.props.close_preview}
                    className="close_btn_wrapper">
                    <div className="small_icon close_btn"/>
                    <div className="medium_icon close_btn_h"/>
                  </div>
                </div>
                <div className="right_panes">
                  {this.panes.map((p, idx)=>(
                    <Pane key={p.id} width={p.width} id={p.id} idx={idx}
                      on_click={this.select_pane}
                      active={this.state.cur_pane==idx}/>
                  ))}
                  <Pane_slider panes={this.panes}
                    cur_pane={this.state.cur_pane}/>
                </div>
              </div>
              <div className="tabbed_pane_content">
                <Pane_content key={req.uuid} req={req}/>
              </div>
            </div>
        );
    }
}

const Pane_slider = ({panes, cur_pane})=>{
    const slider_class = classnames('pane_slider');
    const offset = panes.slice(0, cur_pane).reduce((acc, e)=>acc+e.width, 0);
    const slider_style = {
        width: panes[cur_pane].width,
        transform: `translateX(${offset}px)`,
    };
    return <div className={slider_class} style={slider_style}/>;
};

const Pane = ({id, idx, width, on_click, active})=>(
    <div onClick={()=>on_click(idx)} style={{width}}
      className={classnames('pane', id, {active})}>
      <span>{id}</span>
    </div>
);

class Pane_headers extends Pure_component {
    render(){
        const {req} = this.props;
        const general_entries = [{name: 'Request URL', value: req.request.url},
            {name: 'Status Code', value: req.response.status}];
        return (
            <ol className="tree_outline">
              <Preview_section title="General" pairs={general_entries}/>
              <Preview_section title="Response headers"
                pairs={req.response.headers}/>
              <Preview_section title="Request headers"
                pairs={req.request.headers}/>
             </ol>
        );
    }
}

class Pane_response extends Pure_component {
    componentDidMount(){
        this.cm = codemirror.fromTextArea(this.textarea, {
            readOnly: 'nocursor',
            lineNumbers: true,
        });
        this.cm.setSize('100%', '100%');
        this.cm.doc.setValue(this.props.req.response.content.text);
        this.set_ct();
    }
    componentDidUpdate(){
        this.cm.doc.setValue(this.props.req.response.content.text||'');
        this.set_ct();
    }
    set_ct(){
        const header = this.props.req.response.headers.filter(
            h=>h.name=='content-type');
        if (!header[0])
            return this.cm.setOption('mode', 'javascript');
        const ct = header[0].value;
        let mode = 'javascript';
        if (ct.match(/json/))
            mode = 'javascript';
        if (ct.match(/html/))
            mode = 'htmlmixed';
        this.cm.setOption('mode', mode);
    }
    set_textarea = ref=>{ this.textarea = ref; };
    render(){
        return (
            <div className="codemirror_wrapper">
              <textarea ref={this.set_textarea}/>
            </div>
        );
    }
}

class Preview_section extends Pure_component {
    state = {open: true};
    toggle = ()=>this.setState(prev=>({open: !prev.open}));
    render(){
        return [
            <li key="li" onClick={this.toggle}
              className={classnames('parent', {open: this.state.open})}>
              {this.props.title}
              {!this.state.open ? ` (${this.props.pairs.length})` : ''}
            </li>,
            <ol key="ol"
              className={classnames('children', {open: this.state.open})}>
              {this.props.pairs.map(p=>(
                <Header_pair key={p.name} name={p.name} value={p.value}/>
              ))}
            </ol>
        ];
    }
}

const Header_pair = ({name, value})=>{
    if (name=='Status Code'&&value=='200')
        value = <div className="status_wrapper">
            <div className="small_icon green_status"/>{value}</div>;
    return (
        <li className="treeitem">
          <div className="header_name">{name}: </div>
          <div className="header_value">{value}</div>
        </li>
    );
};

class Pane_timing extends Pure_component {
    render(){
        const {timings, time, startedDateTime} = this.props.req;
        const sections = ['Resource Scheduling', 'Request/Response'];
        const perc = [
            {label: 'Queueing', id: 'blocked', section: 0},
            {label: 'Request sent', id: 'send', section: 1},
            {label: 'Waiting (TTFB)', id: 'wait', section: 1},
            {label: 'Content Download', id: 'receive', section: 1},
        ].reduce((acc, el)=>{
            const cur_time = timings[el.id];
            const left = acc.offset;
            const dur = Number((cur_time/time).toFixed(4));
            const right = 1-acc.offset-dur;
            return {offset: acc.offset+dur, data: [...acc.data,
                {...el, left: `${left*100}%`, right: `${right*100}%`}]};
        }, {offset: 0, data: []}).data
        .reduce((acc, el)=>{
            if (el.section!=acc.last_section)
                return {last_section: el.section, data: [...acc.data, [el]]};
            return {
                last_section: el.section,
                data: [
                    ...acc.data.slice(0, -1),
                    [...acc.data.slice(-1)[0], el],
                ],
            };
        }, {last_section: -1, data: []}).data;
        const started_at = moment(new Date(startedDateTime)).format(
            'YYYY-MM-DD HH:mm:ss');
        return (
            <div className="timing_view_wrapper">
              <table>
                <colgroup>
                  <col className="labels"/>
                  <col className="bars"/>
                  <col className="duration"/>
                </colgroup>
                <thead className="network_timing_start">
                  <tr>
                    <td colSpan="2">Started at {started_at}</td>
                  </tr>
                </thead>
                <tbody>
                  {perc.map((s, i)=>(
                    <Timing_header key={i} title={sections[s[0].section]}>
                    {s.map(p=>(
                      <Timing_row title={p.label} id={p.id} left={p.left}
                        key={p.id} right={p.right} time={timings[p.id]}/>
                      ))}
                    </Timing_header>
                  ))}
                  <Timing_footer total={time}/>
                </tbody>
              </table>
            </div>
        );
    }
}

const Timing_header = ({title, children})=>[
    <tr key="timing_header" className="table_header">
      <td>{title}</td>
      <td></td>
      <td>TIME</td>
    </tr>,
    ...children,
];

const Timing_row = ({title, id, left, right, time})=>(
    <tr className="timing_row">
      <td>{title}</td>
      <td>
        <div className="timing_bar_wrapper">
          <span className={classnames('timing_bar', id)} style={{left, right}}>
            &#8203;</span>
        </div>
      </td>
      <td><div className="timing_bar_title">{time} ms</div></td>
    </tr>
);

const network_explanation_url = 'https://developers.google.com/web/tools/'
+'chrome-devtools/network-performance/reference#timing-explanation';
const Timing_footer = ({total})=>(
    <tr className="timing_footer">
      <td colSpan="1">
        <a className="devtools_link"
          role="link"
          tabIndex="0"
          target="_blank"
          href={network_explanation_url}
          style={{display: 'inline', cursor: 'pointer'}}>
          Explanation
        </a>
      </td>
      <td></td>
      <td>{total} ms</td>
    </tr>
);

class Pane_preview extends Pure_component {
    state = {};
    componentDidMount(){
        setdb.on('test', json=>this.setState({json}));
    }
    render(){
        let json;
        const text = this.props.req.response.content.text;
        if (json = this.state.json||is_json_str(text))
            return <JSON_viewer json={json}/>;
        return (
            <div className="pane_preview"></div>
        );
    }
}

export default Logs;