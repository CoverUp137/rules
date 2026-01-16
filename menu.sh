#!/bin/bash

# 设置颜色
BRIGHT_GREEN="\033[1;32m"  
YELLOW="\033[33m"
BLUE="\033[34m"
RED="\033[31m"
NC="\033[0m"  

# 打印菜单
show_menu() {
    echo -e "${BRIGHT_GREEN}请选择一个选项执行：${NC}"
    echo -e "${BLUE}====================${NC}"
    
    echo -e "${YELLOW}系统管理：${NC}"
    echo -e "1: GNU/Linux 更换系统软件源"
    echo -e "2: Docker 安装与换源"
    echo -e "3: Docker 更换镜像加速器"
    echo -e "4: Ubuntu/Debian 使用 root 登录 SSH"
    echo -e "${YELLOW}====================${NC}"
    
    echo -e "${YELLOW}工具安装：${NC}"
    echo -e "5: 安装1panel面板"
    echo -e "6: 安装lucky大吉"
    echo -e "${YELLOW}====================${NC}"
    
    echo -e "${YELLOW}容器管理：${NC}"
    echo -e "7: Docker 容器项目安装"
    echo -e "${BLUE}====================${NC}"
    
    echo -e "q: 退出"
    echo -e "${BLUE}====================${NC}"
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
    echo -e "1: 安装 portainer-ce(9000端口)"
    echo -e "2: 安装青龙容器(1997端口)"
    echo -e "q: 返回主菜单"
    read -p "请输入选项 (1/2/q): " docker_choice

    case $docker_choice in
        1) install_portainer ;;
        2) install_qinglong ;;
        q) return ;;
        *) echo -e "${RED}无效选项，请重新输入。${NC}" ;;
    esac
}

# 安装 portainer-ce
install_portainer() {
    echo -e "${BRIGHT_GREEN}正在安装 portainer-ce...${NC}"
    docker run -d \
      -p 9000:9000 \
      --name portainer \
      --restart=always \
      -v /var/run/docker.sock:/var/run/docker.sock \
      -v portainer_data:/data \
      portainer/portainer-ce:latest
}

# 安装青龙容器
install_qinglong() {
    echo -e "${BRIGHT_GREEN}正在安装青龙容器(1997端口)...${NC}"
    docker run -dit \
       -v $PWD/ql/data:/ql/data \
       -p 1997:5700 \
       --name qinglong \
       --hostname qinglong \
       --restart always \
       whyour/qinglong:debian
}

# 主循环
while true; do
    show_menu
    read -p "请输入选项 (1/2/3/4/5/6/7/q): " choice
    case $choice in
        1) change_system_sources ;;
        2) install_docker ;;
        3) change_docker_registry ;;
        4) enable_root_ssh ;;
        5) install_1panel ;;
        6) install_lucky ;;
        7) docker_project_install ;;
        q) echo -e "${BRIGHT_GREEN}退出程序。${NC}"; exit 0 ;;
        *) echo -e "${RED}无效选项，请重新输入。${NC}" ;;
    esac
done