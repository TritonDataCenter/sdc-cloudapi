#
# Copyright (c) 2012, Joyent, Inc. All rights reserved.
#
# Makefile: basic Makefile for template API service
#
# This Makefile is a template for new repos. It contains only repo-specific
# logic and uses included makefiles to supply common targets (javascriptlint,
# jsstyle, restdown, etc.), which are used by other repos as well. You may well
# need to rewrite most of this file, but you shouldn't need to touch the
# included makefiles.
#
# If you find yourself adding support for new targets that could be useful for
# other projects too, you should add these to the original versions of the
# included Makefiles (in eng.git) so that other teams can use them too.
#

#
# Tools
#
NODE            := node
NPM		:= npm
TAP		:= ./node_modules/.bin/tap

#
# Files
#
CFG_FILE         = etc/cloudapi.coal.cfg
DOC_FILES	 = index.restdown
JS_FILES	:= $(shell find lib -name '*.js')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = main.js $(JS_FILES)
JSSTYLE_FLAGS    = -f tools/jsstyle.conf
JSSTYLE_FILES	 = $(JS_FILES)
SMF_MANIFESTS	 = smf/manifests/cloudapi.xml

#
# Repo-specific targets
#
.PHONY: all
all:
	$(NPM) rebuild

.PHONY: test
test: $(TAP)
	$(TAP) --timeout 120 test/*.test.js

include ./Makefile.deps
include ./Makefile.targ
