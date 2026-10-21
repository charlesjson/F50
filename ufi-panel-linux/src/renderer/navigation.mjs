export const NAV = [
  { id: 'overview', title: '概览', icon: 'overview', pages: [['overview','设备总览'],['history','历史监控'],['signal','网络参数'],['traffic','流量统计'],['location','设备定位']] },
  { id: 'network', title: '网络', icon: 'signal', pages: [['network','蜂窝与 SIM'],['wifi','Wi-Fi'],['radio','频段与基站'],['apn','APN'],['lan','LAN / USB'],['clients','连接终端']] },
  { id: 'messages', title: '消息', icon: 'mail', pages: [['sms','短信'],['forward','转发与通知'],['zwrt-activity','通知与执行记录']] },
  { id: 'tools', title: '工具', icon: 'terminal', pages: [['speed','测速'],['tools','AT / Shell'],['proxy','HTTP 代理'],['zwrt-control','datad 控制台'],['usb','USB 信息']] },
  { id: 'automation', title: '自动化', icon: 'refresh', pages: [['tasks','定时任务'],['zwrt-recovery','断网自动恢复']] },
  { id: 'system', title: '系统', icon: 'settings', pages: [['device','设备管理'],['voice','VoLTE / VoNR'],['plugins','插件'],['updates','UFI 更新'],['zwrt-updates','datad 更新'],['appearance','外观与文件'],['authentication','认证设置'],['service','资源服务器'],['zwrt-remote','远程管理'],['preferences','客户端设置']] },
];
export const NETWORK_PAGES = ['network','wifi','radio','apn','lan'];
export class Navigation {
  constructor(navigate) {
    this.navigate = navigate; this.last = {};
    const root = document.getElementById('primary-nav'); root.replaceChildren();
    for (const group of NAV) {
      const button = document.createElement('button'); button.className = 'nav'; button.dataset.group = group.id;
      button.innerHTML = `<svg class="icon" aria-hidden="true"><use href="./icons.svg#${group.icon}"/></svg>`;
      button.append(document.createTextNode(group.title)); button.addEventListener('click', () => navigate(this.last[group.id] || group.pages[0][0])); root.append(button);
    }
  }
  select(page) {
    const group = NAV.find(g => g.pages.some(([id]) => id === page)); if (!group) return;
    this.last[group.id] = page;
    document.querySelectorAll('[data-group]').forEach(button => { button.classList.toggle('active', button.dataset.group === group.id); button.setAttribute('aria-current', button.dataset.group === group.id ? 'page' : 'false'); });
    const root = document.getElementById('secondary-nav'); root.replaceChildren();
    for (const [id, title] of group.pages) {
      const button = document.createElement('button'); button.dataset.view = id; button.textContent = title;
      button.className = id === page ? 'active' : ''; button.setAttribute('aria-current', id === page ? 'page' : 'false');
      button.addEventListener('click', () => this.navigate(id)); root.append(button);
    }
    root.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
