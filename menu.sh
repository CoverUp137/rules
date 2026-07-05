#!/bin/bash

# 设置颜色
BRIGHT_GREEN="\033[1;32m"  
YELLOW="\033[33m"
BLUE="\033[34m"
RED="\033[31m"
NC="\033[0m"  


# 选择系统类型
select_system_type() {
    echo -e "${BRIGHT_GREEN}请选择您的系统类型：${NC}"
    echo -e "${BLUE}====================${NC}"
    echo -e "1: Debian/Ubuntu 系统"
    echo -e "2: OpenWrt 系统"
    echo -e "${BLUE}====================${NC}"
    echo -e "q: 退出"
    echo -e "${BLUE}====================${NC}"
    
    read -p "请输入选项 (1-2, q:退出): " system_choice
    case $system_choice in
        1) debian_ubuntu_menu ;;
        2) openwrt_menu ;;
        q) echo -e "${BRIGHT_GREEN}退出程序。${NC}"; exit 0 ;;
        *) echo -e "${RED}无效选项，请重新输入。${NC}"; select_system_type ;;
    esac
}

# Debian/Ubuntu 主菜单
debian_ubuntu_menu() {
    while true; do
        echo -e "${BRIGHT_GREEN}Debian/Ubuntu 系统管理菜单${NC}"
        echo -e "${BLUE}====================${NC}"
        
        echo -e "${YELLOW}系统管理：${NC}"
        echo -e "1: GNU/Linux 更换系统软件源"
        echo -e "2: Docker 安装与换源"
        echo -e "3: Docker 更换镜像加速器"
        echo -e "4: Ubuntu/Debian 使用 root 登录 SSH"
        echo -e "5: 设置系统时区"
        echo -e "6: 安装 FTP 并使用 root 登录"
        echo -e "${YELLOW}====================${NC}"
        
        echo -e "${YELLOW}工具安装：${NC}"
        echo -e "7: 安装1panel面板"
        echo -e "8: 安装lucky大吉"
        echo -e "${YELLOW}====================${NC}"
        
        echo -e "${YELLOW}容器管理：${NC}"
        echo -e "9: Docker 容器项目安装"
        echo -e "${BLUE}====================${NC}"
        
        echo -e "${YELLOW}PVE虚拟机：${NC}"
        echo -e "10: 安装VE-Tools-9"
        echo -e "${BLUE}====================${NC}"
        
        echo -e "b: 返回系统选择"
        echo -e "q: 退出程序"
        echo -e "${BLUE}====================${NC}"
        
        read -p "请输入选项 (1-10, b:返回, q:退出): " choice
        case $choice in
            1) change_system_sources ;;
            2) install_docker ;;
            3) change_docker_registry ;;
            4) enable_root_ssh ;;
            5) set_system_timezone ;;
            6) install_ftp_root_login ;;
            7) install_1panel ;;
            8) install_lucky ;;
            9) docker_project_install ;;
            10) install_pve_tools_9 ;;
            b) return ;;
            q) echo -e "${BRIGHT_GREEN}退出程序。${NC}"; exit 0 ;;
            *) echo -e "${RED}无效选项，请重新输入。${NC}" ;;
        esac
    done
}

# OpenWrt 菜单（预留）
openwrt_menu() {
    echo -e "${BRIGHT_GREEN}OpenWrt 系统管理菜单${NC}"
    echo -e "${BLUE}====================${NC}"
    echo -e "${YELLOW}OpenWrt 功能开发中...${NC}"
    echo -e "${YELLOW}敬请期待！${NC}"
    echo -e "${BLUE}====================${NC}"
    
    read -p "按回车键返回系统选择..."
    return
}

# 更换系统软件源
change_system_sources() {
    echo -e "${BRIGHT_GREEN}正在更换系统软件源...${NC}"
    bash <(curl -sSL https://linuxmirrors.cn/main.sh)
}

# 安装 Docker 并更换源
install_docker() {
    echo -e "${BRIGHT_GREEN}正在安装 Docker 并更换源...${NC}"
    bash <(curl -sSL https://linuxmirrors.cn/docker.sh)
}

# 更换 Docker 镜像加速器
change_docker_registry() {
    echo -e "${BRIGHT_GREEN}正在更换 Docker 镜像加速器...${NC}"
    bash <(curl -sSL https://linuxmirrors.cn/docker.sh) --only-registry
}

# 启用 root 用户 SSH 登录
enable_root_ssh() {
    echo -e "${BRIGHT_GREEN}正在启用 root 用户通过 SSH 登录...${NC}"
    sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
    systemctl restart sshd
    systemctl restart ssh
    echo -e "${BRIGHT_GREEN}root 用户 SSH 登录已启用并重启 SSH 服务。${NC}"
}

# 设置系统时区
set_system_timezone() {
    echo -e "${BRIGHT_GREEN}正在设置系统时区...${NC}"
    dpkg-reconfigure tzdata
}

# 安装 FTP 并使用 root 登录
install_ftp_root_login() {
    echo -e "${BRIGHT_GREEN}正在安装 FTP 并启用 root 登录...${NC}"
    apt install vsftpd -y
    sed -i 's/^#*listen.*/listen=YES/' /etc/vsftpd.conf
    sed -i 's/^#*listen_ipv6.*/# listen_ipv6/' /etc/vsftpd.conf
    sed -i 's/^#*anonymous_enable.*/anonymous_enable=YES/' /etc/vsftpd.conf
    sed -i 's/^#*write_enable.*=.*/write_enable=YES/' /etc/vsftpd.conf
    sed -i 's/^#*anon_mkdir_write_enable.*=.*/anon_mkdir_write_enable=YES/' /etc/vsftpd.conf
    sed -i 's/^#*root.*/# root/' /etc/ftpusers
    /etc/init.d/vsftpd restart
    echo -e "${BRIGHT_GREEN}FTP 安装并启用了 root 登录。${NC}"
}

# 安装 1panel 面板
install_1panel() {
    echo -e "${BRIGHT_GREEN}正在安装 1panel 面板...${NC}"
    bash -c "$(curl -sSL https://resource.fit2cloud.com/1panel/package/v2/quick_start.sh)"
}

# 安装 lucky 大吉
install_lucky() {
    echo -e "${BRIGHT_GREEN}正在安装 lucky 大吉...${NC}"
    curl -o /tmp/install.sh https://fastly.jsdelivr.net/gh/gdy666/lucky-files@main/golucky.sh && sh /tmp/install.sh https://fastly.jsdelivr.net/gh/gdy666/lucky-files@main 2.15.7
}

# 容器项目安装
docker_project_install() {
    echo -e "${BRIGHT_GREEN}请选择一个容器项目安装选项：${NC}"
    echo -e "1: 安装 portainer-ce"
    echo -e "2: 安装青龙容器"
    echo -e "3: 安装呆呆面板"
    echo -e "4: 安装 dpanel"
    echo -e "q: 返回主菜单"
    read -p "请输入选项 (1-4, q:返回): " docker_choice

    case $docker_choice in
        1) install_portainer ;;
        2) install_qinglong ;;
        3) install_daidai ;;
        4) install_dpanel ;;
        q) return ;;
        *) echo -e "${RED}无效选项，请重新输入。${NC}" ;;
    esac
}

# 安装 portainer-ce
install_portainer() {
    echo -e "${BRIGHT_GREEN}请输入外网访问端口（默认9000）：${NC}"
    read -p "端口: " port
    port=${port:-9000}
    echo -e "${BRIGHT_GREEN}正在安装 portainer-ce...${NC}"
    docker run -d \
      -p $port:9000 \
      --name portainer \
      --restart=always \
      -v /var/run/docker.sock:/var/run/docker.sock \
      -v portainer_data:/data \
      portainer/portainer-ce:latest
}

# 安装青龙容器
install_qinglong() {
    echo -e "${BRIGHT_GREEN}请输入外网访问端口（默认1997）：${NC}"
    read -p "端口: " port
    port=${port:-1997}
    echo -e "${BRIGHT_GREEN}正在安装青龙容器(1997端口)...${NC}"
    docker run -dit \
       -v $PWD/ql/data:/ql/data \
       -p $port:5700 \
       --name qinglong \
       --hostname qinglong \
       --restart always \
       whyour/qinglong:debian
}

# 安装呆呆面板
install_daidai() {
    echo -e "${BRIGHT_GREEN}请输入外网访问端口（默认5700）：${NC}"
    read -p "端口: " port
    port=${port:-5700}
    echo -e "${BRIGHT_GREEN}正在安装呆呆面板（端口: $port）...${NC}"
    
    docker run -d --pull=always \
      --name daidai-panel \
      --restart unless-stopped \
      -p $port:5700 \
      -v $(pwd)/Dumb-Panel:/app/Dumb-Panel \
      -e TZ=Asia/Shanghai \
      -e CONTAINER_NAME=daidai-panel \
      -e IMAGE_NAME=linzixuanzz/daidai-panel:latest \
      -e PANEL_UPDATE_MANAGER=watchtower \
      --label com.centurylinklabs.watchtower.enable=true \
      linzixuanzz/daidai-panel:latest
    
    echo -e "${BRIGHT_GREEN}正在安装 watchtower 用于呆呆面板自动更新...${NC}"
    docker run -d \
      --name daidai-watchtower \
      --restart unless-stopped \
      -v /var/run/docker.sock:/var/run/docker.sock \
      --label com.centurylinklabs.watchtower.enable=false \
      nickfedor/watchtower:latest \
      --label-enable \
      --cleanup \
      --interval 36000
    
    echo -e "${BRIGHT_GREEN}呆呆面板安装完成！${NC}"
    echo -e "${YELLOW}访问地址: http://<服务器IP>:$port${NC}"
}

# 安装 dpanel
install_dpanel() {
    echo -e "${BRIGHT_GREEN}请输入外网访问端口（默认8080）：${NC}"
    read -p "端口: " port
    port=${port:-8080}
    echo -e "${BRIGHT_GREEN}正在安装 dpanel（端口: $port）...${NC}"
    
    docker run -d --name dpanel --restart=always \
      -p $port:8080 \
      -e APP_NAME=dpanel \
      -v /var/run/docker.sock:/var/run/docker.sock \
      -v /home/dpanel:/dpanel \
      dpanel/dpanel:lite
    
    echo -e "${BRIGHT_GREEN}dpanel 安装完成！${NC}"
    echo -e "${YELLOW}访问地址: http://<服务器IP>:$port${NC}"
}

# 安装VE-Tools-9
install_pve_tools_9() {
    echo -e "${BRIGHT_GREEN}正在安装VE-Tools-9...${NC}"
    bash <(curl -sSL https://ghfast.top/raw.githubusercontent.com/PVE-Tools/PVE-Tools-9/main/PVE-Tools.sh)
    echo -e "${BRIGHT_GREEN}VE-Tools-9安装完成。${NC}"
}

# 主循环
while true; do
    select_system_type
done
